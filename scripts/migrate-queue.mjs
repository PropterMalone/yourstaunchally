#!/usr/bin/env node
/**
 * One-time migration: delete idle lobbies, seed signup queue, DM affected players.
 *
 * Usage: node scripts/migrate-queue.mjs
 * Requires: DB_PATH env var (or defaults to /data/yourstaunchally.db)
 *           BSKY_IDENTIFIER + BSKY_PASSWORD for DMs (optional — skips DMs if missing)
 */
import Database from 'better-sqlite3';
import { AtpAgent } from '@atproto/api';

const DB_PATH = process.env['DB_PATH'] || '/data/yourstaunchally.db';

const LOBBIES_TO_DELETE = ['8j1g7v', 'y8ctwh'];
const PLAYERS_TO_SEED = [
	{ did: 'did:plc:66oy4yyfx5wgekpsxtjzruuy', handle: 'brianwithaneye.bsky.social' },
	{ did: 'did:plc:fpdnz2lsg3xzhgrnfl665knq', handle: 'bestjohnpauljones.bsky.social' },
];

const DM_TEXT = `Hey! I've replaced the old lobby system with a matchmaking queue. Your lobby has been closed, but you've been added to the new queue automatically.

How it works now:
• Mention me with "play" to join the queue
• Game starts automatically when 7 players are waiting
• "queue" to see who's in line
• "leave queue" to drop out

You're currently in the queue. When 5 more players join, a game will start!`;

async function main() {
	const db = new Database(DB_PATH);
	db.pragma('journal_mode = WAL');

	// Ensure signup_queue table exists
	db.exec(`
		CREATE TABLE IF NOT EXISTS signup_queue (
			did TEXT PRIMARY KEY,
			handle TEXT NOT NULL,
			queued_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
	`);

	// Delete lobbies
	for (const gameId of LOBBIES_TO_DELETE) {
		const row = db.prepare('SELECT state_json FROM games WHERE game_id = ?').get(gameId);
		if (!row) {
			console.log(`[skip] Game #${gameId} not found`);
			continue;
		}
		db.prepare('DELETE FROM game_posts WHERE game_id = ?').run(gameId);
		db.prepare('DELETE FROM games WHERE game_id = ?').run(gameId);
		console.log(`[deleted] Game #${gameId}`);
	}

	// Seed queue
	const insert = db.prepare(`
		INSERT OR IGNORE INTO signup_queue (did, handle, queued_at)
		VALUES (?, ?, datetime('now'))
	`);
	for (const p of PLAYERS_TO_SEED) {
		const result = insert.run(p.did, p.handle);
		if (result.changes > 0) {
			console.log(`[queued] ${p.handle}`);
		} else {
			console.log(`[skip] ${p.handle} already in queue`);
		}
	}

	const count = db.prepare('SELECT COUNT(*) as c FROM signup_queue').get();
	console.log(`\nQueue size: ${count.c}`);
	db.close();

	// DM players
	const identifier = process.env['BSKY_IDENTIFIER'];
	const password = process.env['BSKY_PASSWORD'];
	if (!identifier || !password) {
		console.log('\n[skip] No BSKY credentials — skipping DMs');
		return;
	}

	const agent = new AtpAgent({ service: 'https://bsky.social' });
	await agent.login({ identifier, password });
	console.log(`\nLogged in as ${identifier}`);

	for (const p of PLAYERS_TO_SEED) {
		try {
			const convo = await agent.api.chat.bsky.convo.getConvoForMembers({
				members: [p.did],
			});
			await agent.api.chat.bsky.convo.sendMessage({
				convoId: convo.data.convo.id,
				message: { text: DM_TEXT },
			});
			console.log(`[dm] Sent to ${p.handle}`);
		} catch (error) {
			console.error(`[dm] Failed to DM ${p.handle}:`, error);
		}
	}

	console.log('\nMigration complete.');
}

main().catch((err) => {
	console.error('Migration failed:', err);
	process.exit(1);
});
