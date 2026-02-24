/**
 * Send power assignment DMs to all players in a game.
 * Usage: npx tsx scripts/send-game-dms.ts <gameId>
 */
import { createAgent } from '../packages/engine/src/bot.js';
import { createDb } from '../packages/engine/src/db.js';
import { createBlueskyDmSender, createChatAgent } from '../packages/engine/src/dm.js';
import { getPossibleOrders } from '../packages/engine/src/adjudicator.js';
import type { Power } from '@yourstaunchally/shared';

async function main() {
	const gameId = process.argv[2];
	if (!gameId) {
		console.error('Usage: npx tsx scripts/send-game-dms.ts <gameId>');
		process.exit(1);
	}

	const identifier = process.env['BSKY_IDENTIFIER'];
	const password = process.env['BSKY_PASSWORD'];
	const dbPath = process.env['DB_PATH'] ?? './data/yourstaunchally.db';

	if (!identifier || !password) {
		console.error('Missing BSKY_IDENTIFIER or BSKY_PASSWORD');
		process.exit(1);
	}

	console.log('[dm] Logging in...');
	const agent = await createAgent({ identifier, password });
	const chatAgent = createChatAgent(agent);
	const dmSender = createBlueskyDmSender(chatAgent);

	const db = createDb({ path: dbPath });
	db.init();

	const state = db.loadGame(gameId);
	if (!state) {
		console.error(`Game #${gameId} not found`);
		process.exit(1);
	}

	if (state.status !== 'active') {
		console.error(`Game #${gameId} is ${state.status}, not active`);
		process.exit(1);
	}

	const units = state.lastUnits ?? {};

	for (const player of state.players) {
		if (!player.power) continue;

		const playerUnits = units[player.power] ?? [];
		const unitList = playerUnits.join(', ');
		const exampleOrder = playerUnits[0] ? `${playerUnits[0]} H` : 'A PAR H';

		const msg = `Game #${state.gameId} has started! You are ${player.power}.\n\nYour units: ${unitList}\n\nSubmit orders via DM:\n#${state.gameId} ${exampleOrder}; ...\n\nSeparate orders with semicolons. DM "#${state.gameId} possible" to see all options.\n\nDeadline: ${state.phaseDeadline}`;

		try {
			await dmSender.sendDm(player.did, msg);
			console.log(`[dm] Sent to @${player.handle} (${player.power})`);
		} catch (error) {
			console.error(`[dm] Failed to DM @${player.handle}: ${error}`);
		}
	}

	console.log('\nDone!');
	db.close();
}

main().catch((error) => {
	console.error('[dm] Fatal:', error);
	process.exit(1);
});
