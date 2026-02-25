/**
 * Entry point — polling loop for mentions and DMs.
 * Resilience features (learned from Skeetwolf):
 * - Mention polling from page 1, not stale cursors
 * - Exponential backoff on errors (15s → 5min cap)
 * - Auth refresh on 401/ExpiredToken
 * - Dedup set capped at 1000 to prevent unbounded memory growth
 * - Timeout wrapping on all API calls
 * - Heartbeat logging every 10 polls
 */
import { createAgent, pollMentions } from './bot.js';
import { createDb } from './db.js';
import {
	createBlueskyDmSender,
	createChatAgent,
	createConsoleDmSender,
	pollInboundDms,
} from './dm.js';
import { createGameManager } from './game-manager.js';
import { createLabelerClient } from './labeler-client.js';
import { createLlmClient } from './llm.js';

const POLL_INTERVAL_MS = 15_000; // 15 seconds
const MAX_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes
const POLL_TIMEOUT_MS = 60_000; // 1 minute per API call

// Prevent silent death from unhandled async errors
process.on('unhandledRejection', (error) => {
	console.error('[unhandled rejection]', error);
});

/** Wrap an async call with a timeout */
function withTimeout<T>(fn: () => Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
		fn().then(
			(val) => {
				clearTimeout(timer);
				resolve(val);
			},
			(err) => {
				clearTimeout(timer);
				reject(err);
			},
		);
	});
}

/** Detect auth errors that need session refresh */
function isAuthError(err: unknown): boolean {
	if (err instanceof Error && err.message.includes('ExpiredToken')) return true;
	if (typeof err === 'object' && err !== null && 'status' in err) {
		return (err as { status: number }).status === 401;
	}
	return false;
}

async function main() {
	const identifier = process.env['BSKY_IDENTIFIER'];
	const password = process.env['BSKY_PASSWORD'];
	const dbPath = process.env['DB_PATH'] ?? '/data/yourstaunchally.db';

	if (!identifier || !password) {
		console.error('Missing BSKY_IDENTIFIER or BSKY_PASSWORD');
		process.exit(1);
	}

	console.log(`[init] Logging in as ${identifier}...`);
	const agent = await createAgent({ identifier, password });
	console.log(`[init] Logged in as ${agent.session?.did}`);

	const db = createDb({ path: dbPath });
	db.init();

	const useLiveDms = process.env['LIVE_DMS'] === '1';
	const chatAgent = useLiveDms ? createChatAgent(agent) : null;
	const dmSender =
		useLiveDms && chatAgent ? createBlueskyDmSender(chatAgent) : createConsoleDmSender();

	// LLM for in-character DM responses (optional — degrades gracefully)
	const llm = process.env['OLLAMA_URL'] ? createLlmClient() : null;
	if (llm) {
		const available = await llm.isAvailable();
		console.log(
			`[init] LLM: ${available ? 'connected' : 'not available (will retry per-request)'}`,
		);
	}

	// Labeler for game post filtering (optional — degrades gracefully)
	const labelerUrl = process.env['LABELER_URL'];
	const labelerSecret = process.env['LABELER_SECRET'];
	const labeler =
		labelerUrl && labelerSecret ? createLabelerClient(labelerUrl, labelerSecret) : undefined;
	if (labeler) console.log(`[init] Labeler: ${labelerUrl}`);

	const manager = createGameManager({
		agent,
		dmSender,
		db,
		llm: llm ?? undefined,
		labeler,
	});

	// DM cursor persisted to DB (TID-based, lexicographic order)
	let dmCursor = db.getBotState('dm_cursor') ?? undefined;

	// Old account DM forwarding — keep reading DMs sent to the old handle
	const oldIdentifier = process.env['OLD_BSKY_IDENTIFIER'];
	const oldPassword = process.env['OLD_BSKY_PASSWORD'];
	let oldAgent: Awaited<ReturnType<typeof createAgent>> | null = null;
	let oldChatAgent: ReturnType<typeof createChatAgent> | null = null;
	let oldDmCursor = db.getBotState('old_dm_cursor') ?? undefined;
	if (oldIdentifier && oldPassword && useLiveDms) {
		try {
			oldAgent = await createAgent({ identifier: oldIdentifier, password: oldPassword });
			oldChatAgent = createChatAgent(oldAgent);
			console.log(`[init] Old account ${oldIdentifier} logged in for DM forwarding`);
		} catch (err) {
			console.warn('[init] Old account login failed (DM forwarding disabled):', err);
		}
	}

	let backoffMs = POLL_INTERVAL_MS;
	let pollCount = 0;

	console.log('[init] Starting polling loop...');

	/** Try to refresh the session on auth errors */
	async function refreshSession(): Promise<void> {
		console.log('[auth] Refreshing session...');
		try {
			await agent.login({ identifier: identifier as string, password: password as string });
			console.log('[auth] Session refreshed');
		} catch (loginErr) {
			console.error('[auth] Session refresh failed:', loginErr);
		}
	}

	// Unified polling loop — mentions + DMs + tick
	async function poll() {
		pollCount++;
		let hadError = false;

		// -- Mentions --
		try {
			const { notifications } = await withTimeout(
				() => pollMentions(agent),
				POLL_TIMEOUT_MS,
				'pollMentions',
			);

			if (notifications.length > 0) {
				console.log(`[poll] Found ${notifications.length} mention(s)`);
			}

			for (const notification of notifications) {
				try {
					await manager.handleMention(notification);
				} catch (error) {
					console.error('[mention] Error handling mention:', error);
				}
			}
		} catch (error) {
			hadError = true;
			console.error('[poll] Error polling mentions:', error);
			if (isAuthError(error)) await refreshSession();
		}

		// -- DMs --
		if (chatAgent) {
			try {
				const { messages, latestMessageId } = await withTimeout(
					() => pollInboundDms(chatAgent, dmCursor),
					POLL_TIMEOUT_MS,
					'pollInboundDms',
				);

				if (latestMessageId) {
					dmCursor = latestMessageId;
					db.setBotState('dm_cursor', latestMessageId);
				}

				if (messages.length > 0) {
					console.log(`[poll] Found ${messages.length} DM(s)`);
				}

				for (const dm of messages) {
					try {
						await manager.handleDm(dm);
					} catch (error) {
						console.error('[dm] Error handling DM:', error);
					}
				}
			} catch (error) {
				hadError = true;
				console.error('[poll] Error polling DMs:', error);
				if (isAuthError(error)) await refreshSession();
			}
		}

		// -- Old account DMs (forward to game manager + nudge sender to new account) --
		if (oldChatAgent) {
			try {
				const { messages, latestMessageId } = await withTimeout(
					() => pollInboundDms(oldChatAgent, oldDmCursor),
					POLL_TIMEOUT_MS,
					'pollOldDms',
				);

				if (latestMessageId) {
					oldDmCursor = latestMessageId;
					db.setBotState('old_dm_cursor', latestMessageId);
				}

				for (const dm of messages) {
					try {
						// Process the DM normally (orders still work)
						await manager.handleDm(dm);
						// Nudge them to the new account
						const oldDmSender = createBlueskyDmSender(oldChatAgent);
						await oldDmSender.sendDm(
							dm.senderDid,
							'Hey! I moved to a new account: @yrstaunchally.bsky.social\n\nI processed your message this time, but please follow and DM the new account going forward.',
						);
					} catch (error) {
						console.error('[old-dm] Error handling forwarded DM:', error);
					}
				}
			} catch (error) {
				// Non-fatal — old account DM polling is best-effort
				if (isAuthError(error) && oldAgent && oldIdentifier && oldPassword) {
					try {
						await oldAgent.login({ identifier: oldIdentifier, password: oldPassword });
					} catch {
						/* ignore */
					}
				}
			}
		}

		// -- Tick (always runs — phase timers must not stall) --
		try {
			await manager.tick();
		} catch (error) {
			hadError = true;
			console.error('[tick] Error:', error);
		}

		// Backoff on errors, reset on success
		if (hadError) {
			backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
			console.log(`[backoff] Next poll in ${Math.round(backoffMs / 1000)}s`);
		} else {
			backoffMs = POLL_INTERVAL_MS;
		}

		// Heartbeat
		if (pollCount % 10 === 0) {
			const activeCount = db.loadActiveGames().length;
			console.log(`[heartbeat] poll #${pollCount}, ${activeCount} active game(s)`);
		}

		setTimeout(poll, backoffMs);
	}

	poll();

	// Graceful shutdown — close DB cleanly on Docker stop/restart
	function shutdown(signal: string) {
		console.log(`[shutdown] Received ${signal}, closing DB...`);
		db.close();
		console.log('[shutdown] Done.');
		process.exit(0);
	}
	process.on('SIGTERM', () => shutdown('SIGTERM'));
	process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
	console.error('[fatal]', error);
	process.exit(1);
});
