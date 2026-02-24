/**
 * Post the current game map to Bluesky.
 * Usage: npx tsx scripts/post-map.ts <gameId>
 */
import { createAgent } from '../packages/engine/src/bot.js';
import { createDb } from '../packages/engine/src/db.js';
import { renderMap } from '../packages/engine/src/adjudicator.js';
import { postWithMapSvg } from '../packages/engine/src/map-renderer.js';

async function main() {
	const gameId = process.argv[2];
	if (!gameId) {
		console.error('Usage: npx tsx scripts/post-map.ts <gameId>');
		process.exit(1);
	}

	const agent = await createAgent({
		identifier: process.env['BSKY_IDENTIFIER']!,
		password: process.env['BSKY_PASSWORD']!,
	});

	const db = createDb({ path: process.env['DB_PATH'] ?? './data/yourstaunchally.db' });
	db.init();

	const state = db.loadGame(gameId);
	if (!state) {
		console.error(`Game #${gameId} not found`);
		process.exit(1);
	}

	if (!state.diplomacyState) {
		console.error(`Game #${gameId} has no diplomacy state`);
		process.exit(1);
	}

	console.log(`[map] Rendering map for #${gameId} (${state.currentPhase})...`);
	const { svg } = await renderMap(state.diplomacyState);

	const text = `🗺️ Game #${gameId} — ${state.currentPhase}\n\nThe opening positions. Let the scheming begin.`;

	console.log('[map] Posting...');
	const post = await postWithMapSvg(agent, text, svg, `Diplomacy map — Game #${gameId} ${state.currentPhase}`);
	console.log(`[map] Posted: ${post.uri}`);

	db.recordGamePost(post.uri, post.cid, gameId, agent.session!.did, 'phase', state.currentPhase);
	db.close();
}

main().catch((err) => {
	console.error('[map] Fatal:', err);
	process.exit(1);
});
