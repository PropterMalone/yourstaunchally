/**
 * One-time script: post current gamestate with map and player tags.
 * Run: npx tsx scripts/post-status.ts
 */
import { AtpAgent, RichText } from '@atproto/api';
import { createDb } from '../packages/engine/src/db.js';
import { renderMap } from '../packages/engine/src/adjudicator.js';
import { postWithMapSvg } from '../packages/engine/src/map-renderer.js';

async function main() {
	const identifier = process.env['BSKY_IDENTIFIER'];
	const password = process.env['BSKY_PASSWORD'];
	const dbPath = process.env['DB_PATH'] ?? './data/yourstaunchally.db';
	if (!identifier || !password) {
		console.error('Missing BSKY_IDENTIFIER or BSKY_PASSWORD');
		process.exit(1);
	}

	const agent = new AtpAgent({ service: 'https://bsky.social' });
	await agent.login({ identifier, password });
	console.log(`Logged in as ${agent.session?.handle}`);

	const db = createDb({ path: dbPath });
	db.init();

	const game = db.loadGame('uetpue');
	if (!game) {
		console.error('Game not found');
		process.exit(1);
	}

	const ordersIn = Object.keys(game.currentOrders);
	const totalPlayers = game.players.length;
	const deadline = new Date(game.phaseDeadline!);
	const hoursLeft = Math.round((deadline.getTime() - Date.now()) / (1000 * 60 * 60));

	const playerTags = game.players.map((p) => `@${p.handle}`).join(' ');

	const statusText = `Game #uetpue — ${game.currentPhase}

${ordersIn.length}/${totalPlayers} powers have submitted orders. ~${hoursLeft}h until deadline.

${playerTags}`;

	console.log('Post text:');
	console.log(statusText);
	console.log(`\n(${new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(statusText)[Symbol.iterator]().next().value ? [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(statusText)].length : 0} graphemes)`);

	// Render map
	const { svg } = await renderMap(game.diplomacyState);

	const result = await postWithMapSvg(agent, statusText, svg, `Game #uetpue — ${game.currentPhase} map`);
	console.log(`Posted: ${result.uri}`);

	// Record in game_posts
	db.recordGamePost(result.uri, result.cid, {
		gameId: 'uetpue',
		authorDid: agent.session!.did,
		kind: 'status',
		phase: game.currentPhase,
	});
	console.log('Recorded in game_posts');
}

main().catch((err) => {
	console.error('Fatal:', err);
	process.exit(1);
});
