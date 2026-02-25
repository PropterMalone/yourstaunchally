import { describe, expect, it } from 'vitest';
import {
	abandonGame,
	addPlayer,
	advancePhase,
	allOrdersSubmitted,
	checkSoloVictory,
	claimPower,
	createGame,
	finishGameSoloVictory,
	formatCenterCounts,
	generateGameId,
	getPendingPowers,
	getPlayerForPower,
	getPowerForPlayer,
	isDeadlinePassed,
	removePlayer,
	startGame,
	submitOrders,
	voteDraw,
} from './game-logic.js';
import type { GameState, Power } from './types.js';
import { POWERS } from './types.js';

/** No-shuffle: assigns powers in POWERS order for deterministic tests */
const noShuffle = <T>(arr: T[]): T[] => [...arr];

function lobbyWith(n: number): GameState {
	let state = createGame('test01', '2025-01-01T00:00:00Z');
	for (let i = 0; i < n; i++) {
		const result = addPlayer(state, `did:plc:${i}`, `player${i}.bsky.social`);
		if (!result.ok) throw new Error(result.error);
		state = result.state;
	}
	return state;
}

function activeGame(n = 7): GameState {
	const lobby = lobbyWith(n);
	const result = startGame(lobby, undefined, noShuffle, '2025-01-01T00:00:00Z');
	if (!result.ok) throw new Error(result.error);
	return result.state;
}

describe('createGame', () => {
	it('creates a game in lobby state', () => {
		const game = createGame('abc123');
		expect(game.gameId).toBe('abc123');
		expect(game.status).toBe('lobby');
		expect(game.players).toHaveLength(0);
		expect(game.currentPhase).toBeNull();
	});
});

describe('generateGameId', () => {
	it('generates 6-char alphanumeric IDs', () => {
		const id = generateGameId();
		expect(id).toMatch(/^[a-z0-9]{6}$/);
	});

	it('generates unique IDs', () => {
		const ids = new Set(Array.from({ length: 100 }, generateGameId));
		expect(ids.size).toBeGreaterThan(90); // Probabilistic but safe
	});
});

describe('addPlayer', () => {
	it('adds a player to lobby', () => {
		const game = createGame('test01');
		const result = addPlayer(game, 'did:plc:abc', 'alice.bsky.social');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.state.players).toHaveLength(1);
			expect(result.state.players[0]?.handle).toBe('alice.bsky.social');
			expect(result.state.players[0]?.power).toBeNull();
		}
	});

	it('rejects duplicate player', () => {
		const game = createGame('test01');
		const r1 = addPlayer(game, 'did:plc:abc', 'alice.bsky.social');
		if (!r1.ok) throw new Error('setup failed');
		const r2 = addPlayer(r1.state, 'did:plc:abc', 'alice.bsky.social');
		expect(r2.ok).toBe(false);
	});

	it('rejects when game is full', () => {
		const game = lobbyWith(7);
		const result = addPlayer(game, 'did:plc:extra', 'extra.bsky.social');
		expect(result.ok).toBe(false);
	});

	it('rejects when game is active', () => {
		const game = activeGame();
		const result = addPlayer(game, 'did:plc:new', 'new.bsky.social');
		expect(result.ok).toBe(false);
	});
});

describe('removePlayer', () => {
	it('removes a player from lobby', () => {
		const game = lobbyWith(3);
		const result = removePlayer(game, 'did:plc:1');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.state.players).toHaveLength(2);
		}
	});

	it('rejects removing non-existent player', () => {
		const game = lobbyWith(3);
		const result = removePlayer(game, 'did:plc:nonexistent');
		expect(result.ok).toBe(false);
	});
});

describe('startGame', () => {
	it('starts a game with 7 players', () => {
		const lobby = lobbyWith(7);
		const result = startGame(lobby, undefined, noShuffle, '2025-01-01T00:00:00Z');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.state.status).toBe('active');
			expect(result.state.currentPhase).toBe('S1901M');
			expect(result.state.startedAt).toBe('2025-01-01T00:00:00Z');
			// With noShuffle, powers assigned in order
			expect(result.state.players[0]?.power).toBe('AUSTRIA');
			expect(result.state.players[6]?.power).toBe('TURKEY');
		}
	});

	it('starts a game with 3 players (minimum)', () => {
		const lobby = lobbyWith(3);
		const result = startGame(lobby, undefined, noShuffle, '2025-01-01T00:00:00Z');
		expect(result.ok).toBe(true);
		if (result.ok) {
			// Only 3 players get powers
			const withPowers = result.state.players.filter((p) => p.power !== null);
			expect(withPowers).toHaveLength(3);
		}
	});

	it('rejects start with fewer than 2 players', () => {
		const lobby = lobbyWith(1);
		const result = startGame(lobby);
		expect(result.ok).toBe(false);
	});

	it('sets phase deadline', () => {
		const lobby = lobbyWith(7);
		const result = startGame(lobby, undefined, noShuffle, '2025-01-01T00:00:00Z');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.state.phaseDeadline).toBe('2025-01-03T00:00:00.000Z'); // +48h
		}
	});
});

describe('submitOrders', () => {
	it('accepts orders from an assigned power', () => {
		const game = activeGame();
		const result = submitOrders(game, 'AUSTRIA', ['A BUD - SER', 'A VIE - BUD', 'F TRI - ALB']);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.state.currentOrders['AUSTRIA']?.orders).toHaveLength(3);
		}
	});

	it('rejects orders when game is not active', () => {
		const game = createGame('test');
		const result = submitOrders(game, 'AUSTRIA', ['A BUD H']);
		expect(result.ok).toBe(false);
	});

	it('allows overwriting previous orders for same unit', () => {
		const game = activeGame();
		const r1 = submitOrders(game, 'AUSTRIA', ['A BUD H']);
		if (!r1.ok) throw new Error('setup');
		const r2 = submitOrders(r1.state, 'AUSTRIA', ['A BUD - SER']);
		expect(r2.ok).toBe(true);
		if (r2.ok) {
			expect(r2.state.currentOrders['AUSTRIA']?.orders).toEqual(['A BUD - SER']);
		}
	});

	it('merges partial submissions with existing orders', () => {
		const game = activeGame();
		const r1 = submitOrders(game, 'AUSTRIA', ['A BUD - SER', 'A VIE - BUD', 'F TRI - ALB']);
		if (!r1.ok) throw new Error('setup');
		// Submit new order for only F TRI — should keep A BUD and A VIE
		const r2 = submitOrders(r1.state, 'AUSTRIA', ['F TRI H']);
		expect(r2.ok).toBe(true);
		if (r2.ok) {
			expect(r2.state.currentOrders['AUSTRIA']?.orders).toEqual([
				'A BUD - SER',
				'A VIE - BUD',
				'F TRI H',
			]);
		}
	});

	it('full resubmission replaces all orders', () => {
		const game = activeGame();
		const r1 = submitOrders(game, 'AUSTRIA', ['A BUD - SER', 'A VIE - BUD', 'F TRI - ALB']);
		if (!r1.ok) throw new Error('setup');
		const r2 = submitOrders(r1.state, 'AUSTRIA', ['A BUD H', 'A VIE H', 'F TRI H']);
		expect(r2.ok).toBe(true);
		if (r2.ok) {
			expect(r2.state.currentOrders['AUSTRIA']?.orders).toEqual(['A BUD H', 'A VIE H', 'F TRI H']);
		}
	});
});

describe('getPendingPowers / allOrdersSubmitted', () => {
	it('lists all assigned powers initially', () => {
		const game = activeGame();
		expect(getPendingPowers(game)).toHaveLength(7);
		expect(allOrdersSubmitted(game)).toBe(false);
	});

	it('removes power after order submission', () => {
		let game = activeGame();
		for (const power of POWERS) {
			const result = submitOrders(game, power, ['dummy']);
			if (result.ok) game = result.state;
		}
		expect(getPendingPowers(game)).toHaveLength(0);
		expect(allOrdersSubmitted(game)).toBe(true);
	});
});

describe('voteDraw', () => {
	it('records a draw vote', () => {
		const game = activeGame();
		const result = voteDraw(game, 'AUSTRIA');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.state.drawVote.votedPowers).toContain('AUSTRIA');
			expect(result.drawAchieved).toBe(false);
		}
	});

	it('achieves draw when all powers vote', () => {
		let game = activeGame();
		for (const power of POWERS.slice(0, -1)) {
			const result = voteDraw(game, power);
			if (!result.ok) throw new Error(result.error);
			game = result.state;
		}
		const lastPower = POWERS[POWERS.length - 1] as Power;
		const final = voteDraw(game, lastPower);
		expect(final.ok).toBe(true);
		if (final.ok) {
			expect(final.drawAchieved).toBe(true);
			expect(final.state.status).toBe('finished');
			expect(final.state.endReason).toBe('draw');
		}
	});

	it('rejects duplicate vote', () => {
		const game = activeGame();
		const r1 = voteDraw(game, 'FRANCE');
		if (!r1.ok) throw new Error('setup');
		const r2 = voteDraw(r1.state, 'FRANCE');
		expect(r2.ok).toBe(false);
	});
});

describe('advancePhase', () => {
	it('updates phase and clears orders', () => {
		let game = activeGame();
		const r = submitOrders(game, 'AUSTRIA', ['A BUD H']);
		if (r.ok) game = r.state;

		const advanced = advancePhase(game, 'F1901M', { some: 'state' });
		expect(advanced.currentPhase).toBe('F1901M');
		expect(advanced.currentOrders).toEqual({});
		expect(advanced.drawVote.votedPowers).toHaveLength(0);
		expect(advanced.diplomacyState).toEqual({ some: 'state' });
	});

	it('sets shorter deadline for retreat phases', () => {
		const game = activeGame();
		const advanced = advancePhase(game, 'S1901R', null, undefined, '2025-01-01T00:00:00Z');
		expect(advanced.phaseDeadline).toBe('2025-01-02T00:00:00.000Z'); // +24h
	});
});

describe('checkSoloVictory', () => {
	it('returns null when no one has 18 centers', () => {
		const centers = { FRANCE: Array(17).fill('X'), GERMANY: ['BER'] };
		expect(checkSoloVictory(centers)).toBeNull();
	});

	it('detects solo victory at 18 centers', () => {
		const centers = { FRANCE: Array(18).fill('X'), GERMANY: [] };
		expect(checkSoloVictory(centers)).toEqual({ winner: 'FRANCE' });
	});
});

describe('finishGameSoloVictory', () => {
	it('marks game as finished with winner', () => {
		const game = activeGame();
		const finished = finishGameSoloVictory(game, 'FRANCE');
		expect(finished.status).toBe('finished');
		expect(finished.endReason).toBe('solo_victory');
		expect(finished.winner).toBe('FRANCE');
	});
});

describe('abandonGame', () => {
	it('marks game as abandoned', () => {
		const game = activeGame();
		const abandoned = abandonGame(game);
		expect(abandoned.status).toBe('finished');
		expect(abandoned.endReason).toBe('abandoned');
	});
});

describe('claimPower', () => {
	it('lets a new player claim an unassigned power', () => {
		// Start with 3 players → 4 powers unassigned
		const game = activeGame(3);
		const result = claimPower(game, 'did:plc:newcomer', 'newcomer.bsky.social', 'TURKEY');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.state.players).toHaveLength(4);
			const newPlayer = result.state.players.find((p) => p.did === 'did:plc:newcomer');
			expect(newPlayer?.power).toBe('TURKEY');
		}
	});

	it('rejects claiming an already-assigned power', () => {
		const game = activeGame(7); // All powers assigned
		const result = claimPower(game, 'did:plc:newcomer', 'newcomer.bsky.social', 'AUSTRIA');
		expect(result.ok).toBe(false);
	});

	it('rejects if player is already in the game', () => {
		const game = activeGame(3);
		const existingDid = game.players[0]?.did ?? '';
		const result = claimPower(game, existingDid, 'existing.bsky.social', 'TURKEY');
		expect(result.ok).toBe(false);
	});

	it('rejects claiming in a lobby game', () => {
		const lobby = lobbyWith(3);
		const result = claimPower(lobby, 'did:plc:newcomer', 'newcomer.bsky.social', 'FRANCE');
		expect(result.ok).toBe(false);
	});
});

describe('isDeadlinePassed', () => {
	it('returns false before deadline', () => {
		const game = activeGame();
		expect(isDeadlinePassed(game, new Date('2025-01-02T00:00:00Z'))).toBe(false);
	});

	it('returns true after deadline', () => {
		const game = activeGame();
		expect(isDeadlinePassed(game, new Date('2025-01-04T00:00:00Z'))).toBe(true);
	});
});

describe('player/power lookups', () => {
	it('getPlayerForPower finds the player', () => {
		const game = activeGame();
		const player = getPlayerForPower(game, 'AUSTRIA');
		expect(player?.did).toBe('did:plc:0');
	});

	it('getPowerForPlayer finds the power', () => {
		const game = activeGame();
		expect(getPowerForPlayer(game, 'did:plc:0')).toBe('AUSTRIA');
	});

	it('getPowerForPlayer returns null for non-player', () => {
		const game = activeGame();
		expect(getPowerForPlayer(game, 'did:plc:nonexistent')).toBeNull();
	});
});

describe('formatCenterCounts', () => {
	it('formats center counts sorted by count descending', () => {
		const centers = {
			FRANCE: ['PAR', 'MAR', 'BRE', 'SPA', 'POR'],
			GERMANY: ['BER', 'KIE', 'MUN'],
			AUSTRIA: [],
		};
		const result = formatCenterCounts(centers);
		expect(result).toBe('FRANCE: 5 | GERMANY: 3');
	});
});
