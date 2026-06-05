#!/usr/bin/env node
/**
 * Force-end a game as a draw. Renders final map, posts announcement, updates DB.
 *
 * Usage (inside Docker): node scripts/end-game-draw.mjs <gameId>
 * Usage (via compose):   docker compose exec engine node scripts/end-game-draw.mjs uetpue
 */

import Database from 'better-sqlite3';
import { AtpAgent } from '@atproto/api';

const gameId = process.argv[2];
if (!gameId) {
	console.error('usage: node scripts/end-game-draw.mjs <gameId>');
	process.exit(1);
}

const dbPath = process.env.DB_PATH || '/data/yourstaunchally.db';
const db = new Database(dbPath);

// Load game
const row = db.prepare('SELECT state_json FROM games WHERE game_id = ?').get(gameId);
if (!row) {
	console.error(`game ${gameId} not found`);
	process.exit(1);
}
const state = JSON.parse(row.state_json);
console.log(`Game #${gameId}: ${state.currentPhase}, status=${state.status}`);

if (state.status !== 'active') {
	console.error(`game is ${state.status}, not active`);
	process.exit(1);
}

// Build standings
const centers = state.lastCenters || {};
const standings = Object.entries(centers)
	.filter(([_, c]) => c.length > 0)
	.sort((a, b) => b[1].length - a[1].length)
	.map(([power, c]) => {
		const player = state.players.find((p) => p.power === power);
		const handle = player ? `@${player.handle}` : 'Civil Disorder';
		return `${power} (${handle}): ${c.length}`;
	})
	.join('\n');

console.log('\nStandings:\n' + standings);

// Render map
const { renderMap } = await import('../packages/engine/dist/adjudicator.js');
const { svg } = await renderMap(state.diplomacyState);
console.log(`\nMap rendered (${svg.length} bytes SVG)`);

// Login to Bluesky
const identifier = process.env.BSKY_IDENTIFIER;
const password = process.env.BSKY_PASSWORD;
if (!identifier || !password) {
	console.error('BSKY_IDENTIFIER and BSKY_PASSWORD required');
	process.exit(1);
}

const agent = new AtpAgent({ service: 'https://bsky.social' });
await agent.login({ identifier, password });
console.log(`Logged in as ${identifier}`);

// Post draw announcement with map
const { postWithMapSvg } = await import('../packages/engine/dist/map-renderer.js');
const drawPowers = ['ENGLAND', 'TURKEY', 'RUSSIA'];
const drawNames = drawPowers.map((power) => {
	const player = state.players.find((p) => p.power === power);
	return `${power} (@${player?.handle || '?'})`;
});
const msg = `🤝 Game #${gameId} ends in a three-way draw!\n\n${drawNames.join(', ')}\n\n${standings}`;
const altText = `Diplomacy map — final state of game #${gameId}`;

const drawPost = await postWithMapSvg(agent, msg, svg, altText);
console.log(`\nPosted: ${drawPost.uri}`);

// Record game_over post
const botDid = agent.session?.did;
db.prepare(
	"INSERT OR IGNORE INTO game_posts (uri, cid, game_id, author_did, kind, phase, indexed_at) VALUES (?, ?, ?, ?, 'game_over', ?, ?)",
).run(drawPost.uri, drawPost.cid, gameId, botDid, state.currentPhase, Date.now());

// Update game state
state.status = 'finished';
state.finishedAt = new Date().toISOString();
state.endReason = 'draw';
state.winner = null;

db.prepare(
	"UPDATE games SET status = 'finished', state_json = ?, updated_at = datetime('now') WHERE game_id = ?",
).run(JSON.stringify(state), gameId);

console.log(`\nGame #${gameId} marked as finished (draw)`);
db.close();
