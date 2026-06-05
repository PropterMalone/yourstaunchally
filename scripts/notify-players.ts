/**
 * One-time: DM all players in a game about account migration.
 * Usage: npx tsx --env-file=.env scripts/notify-players.ts
 */
import { AtpAgent } from '@atproto/api';
import Database from 'better-sqlite3';
import type { GameState } from '@yourstaunchally/shared';

const GAME_ID = 'uetpue';
const DB_PATH = process.env['DB_PATH'] || './data/yourstaunchally.db';
const DM_DELAY_MS = 2500; // 2.5s between DMs

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

async function main() {
	const identifier = process.env['BSKY_IDENTIFIER'];
	const password = process.env['BSKY_PASSWORD'];
	if (!identifier || !password) throw new Error('set BSKY_IDENTIFIER and BSKY_PASSWORD');

	const db = new Database(DB_PATH, { readonly: true });
	const row = db.prepare('SELECT state_json FROM games WHERE game_id = ?').get(GAME_ID) as {
		state_json: string;
	};
	const state = JSON.parse(row.state_json) as GameState;

	const agent = new AtpAgent({ service: 'https://bsky.social' });
	await agent.login({ identifier, password });
	console.log(`Logged in as ${agent.session?.handle}`);

	const chatAgent = agent.withProxy('bsky_chat', 'did:web:api.bsky.chat');

	for (const player of state.players) {
		if (!player.power) continue;

		const msg = `Hey ${player.power} — the bot is back on @${identifier}. The spam label has been cleared. Your orders are intact. Submit new orders or check status here.\n\nGame #${GAME_ID}, phase: ${state.currentPhase}`;

		try {
			const convo = await chatAgent.chat.bsky.convo.getConvoForMembers({
				members: [player.did, agent.session?.did as string],
			});
			await chatAgent.chat.bsky.convo.sendMessage({
				convoId: convo.data.convo.id,
				message: { text: msg },
			});
			console.log(`DM sent to ${player.handle} (${player.power})`);
		} catch (err: unknown) {
			const m = err instanceof Error ? err.message : String(err);
			console.log(`Failed to DM ${player.handle}: ${m}`);
		}

		await sleep(DM_DELAY_MS);
	}

	console.log('Done.');
}

main().catch((err) => {
	console.error('Fatal:', err);
	process.exit(1);
});
