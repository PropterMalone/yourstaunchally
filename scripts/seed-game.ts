/**
 * Seed the inaugural Diplomacy game with 7 players.
 * Resolves handles to DIDs, creates the game, assigns powers randomly,
 * initializes the diplomacy engine, and saves to DB.
 *
 * Usage: npx tsx scripts/seed-game.ts
 *
 * Requires BSKY_IDENTIFIER and BSKY_PASSWORD env vars (for handle resolution).
 * Optionally set DB_PATH (default: /data/yourstaunchally.db).
 */
import { createAgent, postThread, resolveHandle } from '../packages/engine/src/bot.js';
import { createDb } from '../packages/engine/src/db.js';
import { newGame } from '../packages/engine/src/adjudicator.js';
import { createGame, addPlayer, startGame, generateGameId, type Power } from '@yourstaunchally/shared';

const PLAYERS = [
	'peark.es',
	'themlg.bsky.social',
	'schroedinger.bsky.social',
	'tonylover.bsky.social',
	'nestor-makflow.bsky.social',
	'wtdore.bsky.social',
	'kingchirp.bsky.social',
];

async function main() {
	const identifier = process.env['BSKY_IDENTIFIER'];
	const password = process.env['BSKY_PASSWORD'];
	const dbPath = process.env['DB_PATH'] ?? './data/yourstaunchally.db';

	if (!identifier || !password) {
		console.error('Missing BSKY_IDENTIFIER or BSKY_PASSWORD');
		process.exit(1);
	}

	console.log('[seed] Logging in...');
	const agent = await createAgent({ identifier, password });
	const botDid = agent.session?.did ?? '';
	console.log(`[seed] Logged in as ${botDid}`);

	// Resolve all player handles to DIDs
	console.log('[seed] Resolving player handles...');
	const players: { handle: string; did: string }[] = [];
	for (const handle of PLAYERS) {
		const did = await resolveHandle(agent, handle);
		if (!did) {
			console.error(`[seed] Failed to resolve handle: ${handle}`);
			process.exit(1);
		}
		console.log(`  ${handle} → ${did}`);
		players.push({ handle, did });
	}

	// Create the game
	const gameId = generateGameId();
	console.log(`[seed] Creating game #${gameId}...`);
	let state = createGame(gameId);

	// Add all players
	for (const player of players) {
		const result = addPlayer(state, player.did, player.handle);
		if (!result.ok) {
			console.error(`[seed] Failed to add ${player.handle}: ${result.error}`);
			process.exit(1);
		}
		state = result.state;
	}
	console.log(`[seed] Added ${players.length} players`);

	// Start the game — assigns powers randomly
	const startResult = startGame(state);
	if (!startResult.ok) {
		console.error(`[seed] Failed to start: ${startResult.error}`);
		process.exit(1);
	}
	state = startResult.state;

	console.log('[seed] Power assignments:');
	for (const player of state.players) {
		console.log(`  ${player.power}: @${player.handle}`);
	}

	// Initialize the diplomacy engine
	console.log('[seed] Initializing diplomacy engine...');
	const adjResult = await newGame();
	state = {
		...state,
		diplomacyState: adjResult.gameState,
		lastCenters: adjResult.centers,
		lastUnits: adjResult.units,
	};

	// Save to database
	console.log(`[seed] Saving to ${dbPath}...`);
	const db = createDb({ path: dbPath });
	db.init();
	db.saveGame(state);

	// Post the game start announcement
	console.log('[seed] Posting game start announcement...');
	const powerList = state.players
		.filter((p) => p.power)
		.map((p) => `${p.power}: @${p.handle}`)
		.join('\n');

	const deadline = state.phaseDeadline
		? new Date(state.phaseDeadline).toLocaleString()
		: '?';

	const startPost = await postThread(
		agent,
		`⚔️ Game #${state.gameId} begins! Phase: ${state.currentPhase}\n\n${powerList}\n\nDeadline: ${deadline}`,
	);
	console.log(`[seed] Announcement posted: ${startPost.uri}`);

	// Save the announcement reference and record it
	state = { ...state, announcementPost: startPost };
	db.saveGame(state);
	db.recordGamePost(startPost.uri, startPost.cid, gameId, botDid, 'game_start', state.currentPhase);

	// Print unit assignments for verification
	console.log('\n[seed] Starting units:');
	for (const player of state.players) {
		if (player.power) {
			const units = adjResult.units[player.power as Power] ?? [];
			console.log(`  ${player.power} (@${player.handle}): ${units.join(', ')}`);
		}
	}

	console.log(`\n✓ Game #${gameId} seeded and announced!`);
	console.log('Players can now submit orders via DM.');
	db.close();
}

main().catch((error) => {
	console.error('[seed] Fatal:', error);
	process.exit(1);
});
