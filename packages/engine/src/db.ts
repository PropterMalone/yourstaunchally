import type { GameState } from '@yourstaunchally/shared';
/**
 * SQLite persistence for Diplomacy games.
 * Game state stored as JSON blob (same pattern as Skeetwolf).
 */
import Database from 'better-sqlite3';

export interface DbConfig {
	path: string;
}

export interface GameDb {
	/** Initialize tables */
	init(): void;
	/** Save or update a game */
	saveGame(state: GameState): void;
	/** Load a game by ID */
	loadGame(gameId: string): GameState | null;
	/** Load all active games */
	loadActiveGames(): GameState[];
	/** Load all games in lobby */
	loadLobbyGames(): GameState[];
	/** Delete a game */
	deleteGame(gameId: string): void;

	/** Bot state persistence (cursors, etc.) */
	getBotState(key: string): string | null;
	setBotState(key: string, value: string): void;

	/** Record a game post for the feed generator */
	recordGamePost(
		uri: string,
		cid: string,
		gameId: string,
		authorDid: string,
		kind: string,
		phase: string | null,
	): void;

	/** Get the most recent post for a game (for quote-threading) */
	getLatestGamePost(gameId: string): { uri: string; cid: string } | null;

	/** Get the most recent phase/game_start post for a game (these have maps) */
	getLatestMapPost(gameId: string): { uri: string; cid: string } | null;

	/** Close the database */
	close(): void;
}

export function createDb(config: DbConfig): GameDb {
	const db = new Database(config.path);
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');

	return {
		init() {
			db.exec(`
				CREATE TABLE IF NOT EXISTS games (
					game_id TEXT PRIMARY KEY,
					status TEXT NOT NULL DEFAULT 'lobby',
					state_json TEXT NOT NULL,
					created_at TEXT NOT NULL,
					updated_at TEXT NOT NULL DEFAULT (datetime('now'))
				);

				CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);

				CREATE TABLE IF NOT EXISTS bot_state (
					key TEXT PRIMARY KEY,
					value TEXT NOT NULL
				);

				CREATE TABLE IF NOT EXISTS game_posts (
					uri TEXT PRIMARY KEY,
					game_id TEXT NOT NULL,
					author_did TEXT NOT NULL,
					kind TEXT NOT NULL,
					phase TEXT,
					indexed_at INTEGER NOT NULL
				);

				CREATE INDEX IF NOT EXISTS idx_game_posts_game_id ON game_posts(game_id, indexed_at);
			`);

			// Migration: add cid column to game_posts (nullable for existing rows)
			const cols = db.pragma('table_info(game_posts)') as { name: string }[];
			if (!cols.some((c) => c.name === 'cid')) {
				db.exec("ALTER TABLE game_posts ADD COLUMN cid TEXT NOT NULL DEFAULT ''");
			}
		},

		saveGame(state: GameState) {
			const json = JSON.stringify(state);
			db.prepare(`
				INSERT INTO games (game_id, status, state_json, created_at, updated_at)
				VALUES (?, ?, ?, ?, datetime('now'))
				ON CONFLICT(game_id) DO UPDATE SET
					status = excluded.status,
					state_json = excluded.state_json,
					updated_at = datetime('now')
			`).run(state.gameId, state.status, json, state.createdAt);
		},

		loadGame(gameId: string): GameState | null {
			const row = db.prepare('SELECT state_json FROM games WHERE game_id = ?').get(gameId) as
				| { state_json: string }
				| undefined;
			if (!row) return null;
			return JSON.parse(row.state_json) as GameState;
		},

		loadActiveGames(): GameState[] {
			const rows = db.prepare("SELECT state_json FROM games WHERE status = 'active'").all() as {
				state_json: string;
			}[];
			return rows.map((r) => JSON.parse(r.state_json) as GameState);
		},

		loadLobbyGames(): GameState[] {
			const rows = db.prepare("SELECT state_json FROM games WHERE status = 'lobby'").all() as {
				state_json: string;
			}[];
			return rows.map((r) => JSON.parse(r.state_json) as GameState);
		},

		deleteGame(gameId: string) {
			db.prepare('DELETE FROM game_posts WHERE game_id = ?').run(gameId);
			db.prepare('DELETE FROM games WHERE game_id = ?').run(gameId);
		},

		getBotState(key: string): string | null {
			const row = db.prepare('SELECT value FROM bot_state WHERE key = ?').get(key) as
				| { value: string }
				| undefined;
			return row?.value ?? null;
		},

		setBotState(key: string, value: string) {
			db.prepare(`
				INSERT INTO bot_state (key, value) VALUES (?, ?)
				ON CONFLICT(key) DO UPDATE SET value = excluded.value
			`).run(key, value);
		},

		recordGamePost(
			uri: string,
			cid: string,
			gameId: string,
			authorDid: string,
			kind: string,
			phase: string | null,
		) {
			db.prepare(`
				INSERT OR IGNORE INTO game_posts (uri, cid, game_id, author_did, kind, phase, indexed_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)
			`).run(uri, cid, gameId, authorDid, kind, phase, Date.now());
		},

		getLatestGamePost(gameId: string): { uri: string; cid: string } | null {
			const row = db
				.prepare(
					"SELECT uri, cid FROM game_posts WHERE game_id = ? AND cid != '' ORDER BY indexed_at DESC LIMIT 1",
				)
				.get(gameId) as { uri: string; cid: string } | undefined;
			return row ?? null;
		},

		getLatestMapPost(gameId: string): { uri: string; cid: string } | null {
			const row = db
				.prepare(
					"SELECT uri, cid FROM game_posts WHERE game_id = ? AND kind IN ('phase', 'game_start', 'game_over') ORDER BY indexed_at DESC LIMIT 1",
				)
				.get(gameId) as { uri: string; cid: string } | undefined;
			return row ?? null;
		},

		close() {
			db.close();
		},
	};
}
