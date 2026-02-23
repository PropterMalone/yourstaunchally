/**
 * Entry point — polling loop for mentions and DMs.
 * Adapted from Skeetwolf's polling loop.
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

const POLL_INTERVAL_MS = 15_000; // 15 seconds
const TICK_INTERVAL_MS = 60_000; // 1 minute

async function main() {
	const identifier = process.env['BSKY_IDENTIFIER'];
	const password = process.env['BSKY_PASSWORD'];
	const dbPath = process.env['DB_PATH'] ?? '/data/yourfriend.db';

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

	const manager = createGameManager({ agent, dmSender, db });

	// Restore cursors from DB
	let mentionCursor = db.getBotState('mention_cursor') ?? undefined;
	let dmCursor = db.getBotState('dm_cursor') ?? undefined;

	console.log('[init] Starting polling loop...');

	// Mention polling
	async function pollMentionLoop() {
		try {
			const { notifications, cursor } = await pollMentions(agent, mentionCursor);
			if (cursor) {
				mentionCursor = cursor;
				db.setBotState('mention_cursor', cursor);
			}

			for (const notification of notifications) {
				try {
					await manager.handleMention(notification);
				} catch (error) {
					console.error('[mention] Error handling mention:', error);
				}
			}
		} catch (error) {
			console.error('[poll] Error polling mentions:', error);
		}

		setTimeout(pollMentionLoop, POLL_INTERVAL_MS);
	}

	// DM polling
	async function pollDmLoop() {
		if (!chatAgent) {
			setTimeout(pollDmLoop, POLL_INTERVAL_MS);
			return;
		}

		try {
			const { messages, latestMessageId } = await pollInboundDms(chatAgent, dmCursor);
			if (latestMessageId) {
				dmCursor = latestMessageId;
				db.setBotState('dm_cursor', latestMessageId);
			}

			for (const dm of messages) {
				try {
					await manager.handleDm(dm);
				} catch (error) {
					console.error('[dm] Error handling DM:', error);
				}
			}
		} catch (error) {
			console.error('[poll] Error polling DMs:', error);
		}

		setTimeout(pollDmLoop, POLL_INTERVAL_MS);
	}

	// Deadline tick
	async function tickLoop() {
		try {
			await manager.tick();
		} catch (error) {
			console.error('[tick] Error:', error);
		}

		setTimeout(tickLoop, TICK_INTERVAL_MS);
	}

	pollMentionLoop();
	pollDmLoop();
	tickLoop();
}

main().catch((error) => {
	console.error('[fatal]', error);
	process.exit(1);
});
