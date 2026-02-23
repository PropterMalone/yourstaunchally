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

	/** Record a game post for feed/threading */
	recordGamePost(gameId: string, postUri: string, postCid: string, postType: string): void;

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
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					game_id TEXT NOT NULL,
					post_uri TEXT NOT NULL UNIQUE,
					post_cid TEXT NOT NULL,
					post_type TEXT NOT NULL,
					created_at TEXT NOT NULL DEFAULT (datetime('now')),
					FOREIGN KEY (game_id) REFERENCES games(game_id)
				);

				CREATE INDEX IF NOT EXISTS idx_game_posts_game ON game_posts(game_id);
			`);
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

		recordGamePost(gameId: string, postUri: string, postCid: string, postType: string) {
			db.prepare(`
				INSERT OR IGNORE INTO game_posts (game_id, post_uri, post_cid, post_type)
				VALUES (?, ?, ?, ?)
			`).run(gameId, postUri, postCid, postType);
		},

		close() {
			db.close();
		},
	};
}
