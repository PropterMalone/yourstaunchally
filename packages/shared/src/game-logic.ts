/**
 * Game state machine — pure functions, no I/O.
 *
 * Lifecycle: lobby → active → finished
 * Phase cycle: S1901M → (S1901R) → F1901M → (F1901R) → W1901A → S1902M → ...
 * Retreat/adjustment phases are skipped if not needed (handled by diplomacy lib).
 */
import type { DrawVote, GameConfig, GameState, PhaseOrders, Player, Power } from './types.js';
import { DEFAULT_GAME_CONFIG, POWERS, SOLO_VICTORY_CENTERS } from './types.js';

/** Create a new game in lobby state */
export function createGame(gameId: string, now = new Date().toISOString()): GameState {
	return {
		gameId,
		status: 'lobby',
		createdAt: now,
		startedAt: null,
		finishedAt: null,
		endReason: null,
		winner: null,
		currentPhase: null,
		players: [],
		currentOrders: {},
		drawVote: { votedPowers: [] },
		phaseDeadline: null,
		announcementPost: null,
		lastCenters: null,
		lastUnits: null,
		diplomacyState: null,
	};
}

/** Generate a short game ID (6 chars, alphanumeric) */
export function generateGameId(): string {
	const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
	let id = '';
	for (let i = 0; i < 6; i++) {
		id += chars[Math.floor(Math.random() * chars.length)];
	}
	return id;
}

/** Add a player to a lobby. Returns updated state or error. */
export function addPlayer(
	state: GameState,
	did: string,
	handle: string,
	config: GameConfig = DEFAULT_GAME_CONFIG,
	now = new Date().toISOString(),
): { ok: true; state: GameState } | { ok: false; error: string } {
	if (state.status !== 'lobby') {
		return { ok: false, error: 'Game is not in lobby' };
	}
	if (state.players.length >= config.maxPlayers) {
		return { ok: false, error: 'Game is full' };
	}
	if (state.players.some((p) => p.did === did)) {
		return { ok: false, error: 'Already joined this game' };
	}

	const player: Player = { did, handle, power: null, joinedAt: now };
	return {
		ok: true,
		state: { ...state, players: [...state.players, player] },
	};
}

/** Remove a player from a lobby */
export function removePlayer(
	state: GameState,
	did: string,
): { ok: true; state: GameState } | { ok: false; error: string } {
	if (state.status !== 'lobby') {
		return { ok: false, error: 'Game is not in lobby' };
	}
	if (!state.players.some((p) => p.did === did)) {
		return { ok: false, error: 'Not in this game' };
	}
	return {
		ok: true,
		state: { ...state, players: state.players.filter((p) => p.did !== did) },
	};
}

/** Claim an unassigned power in an active game (replacement player) */
export function claimPower(
	state: GameState,
	did: string,
	handle: string,
	power: Power,
): { ok: true; state: GameState } | { ok: false; error: string } {
	if (state.status !== 'active') {
		return { ok: false, error: 'Game is not active' };
	}
	if (!POWERS.includes(power)) {
		return { ok: false, error: `${power} is not a valid power` };
	}
	// Check if power is already assigned to a player
	if (state.players.some((p) => p.power === power)) {
		return { ok: false, error: `${power} is already assigned to a player` };
	}
	// Check if this person is already playing
	if (state.players.some((p) => p.did === did)) {
		return { ok: false, error: 'You are already playing in this game' };
	}
	const newPlayer: Player = { did, handle, power, joinedAt: new Date().toISOString() };
	return {
		ok: true,
		state: { ...state, players: [...state.players, newPlayer] },
	};
}

/**
 * Start a game — assign powers randomly, transition to active.
 * Powers are shuffled and assigned to players in order.
 * Unassigned powers enter civil disorder (no player, hold all units).
 *
 * @param shuffle Injectable for testing — defaults to Fisher-Yates
 */
export function startGame(
	state: GameState,
	config: GameConfig = DEFAULT_GAME_CONFIG,
	shuffle: <T>(arr: T[]) => T[] = fisherYatesShuffle,
	now = new Date().toISOString(),
): { ok: true; state: GameState } | { ok: false; error: string } {
	if (state.status !== 'lobby') {
		return { ok: false, error: 'Game is not in lobby' };
	}
	if (state.players.length < config.minPlayers) {
		return { ok: false, error: `Need at least ${config.minPlayers} players` };
	}

	const shuffledPowers = shuffle([...POWERS]);
	const players = state.players.map((p, i) => ({
		...p,
		power: shuffledPowers[i] ?? null,
	}));

	const deadline = new Date(
		new Date(now).getTime() + config.movementPhaseHours * 60 * 60 * 1000,
	).toISOString();

	return {
		ok: true,
		state: {
			...state,
			status: 'active',
			startedAt: now,
			currentPhase: 'S1901M',
			players,
			currentOrders: {},
			drawVote: { votedPowers: [] },
			phaseDeadline: deadline,
		},
	};
}

/** Submit orders for a power in the current phase */
export function submitOrders(
	state: GameState,
	power: Power,
	orders: string[],
	now = new Date().toISOString(),
): { ok: true; state: GameState } | { ok: false; error: string } {
	if (state.status !== 'active') {
		return { ok: false, error: 'Game is not active' };
	}
	if (!state.currentPhase) {
		return { ok: false, error: 'No current phase' };
	}

	// Verify this power is assigned to a player
	const player = state.players.find((p) => p.power === power);
	if (!player) {
		return { ok: false, error: `No player assigned to ${power}` };
	}

	// Merge with existing orders: new orders replace by unit location, existing ones are kept.
	// Unit location = first two tokens (e.g. "A PAR" from "A PAR - BUR").
	// WAIVE is special: multiple WAIVEs are distinct (one per skipped build), so if the new
	// submission includes any WAIVEs, all existing WAIVEs are replaced wholesale.
	const existing = state.currentOrders[power]?.orders ?? [];
	const newUnitKeys = new Set(
		orders.filter((o) => o !== 'WAIVE').map((o) => o.split(/\s+/).slice(0, 2).join(' ')),
	);
	const hasNewWaives = orders.some((o) => o === 'WAIVE');
	const kept = existing.filter((o) => {
		if (o === 'WAIVE') return !hasNewWaives;
		const key = o.split(/\s+/).slice(0, 2).join(' ');
		return !newUnitKeys.has(key);
	});
	const merged = [...kept, ...orders];

	const phaseOrders: PhaseOrders = {
		power,
		orders: merged,
		submittedAt: now,
	};

	return {
		ok: true,
		state: {
			...state,
			currentOrders: { ...state.currentOrders, [power]: phaseOrders },
		},
	};
}

/** Get powers that haven't submitted orders yet */
export function getPendingPowers(state: GameState): Power[] {
	const assignedPowers = state.players.map((p) => p.power).filter((p): p is Power => p !== null);

	return assignedPowers.filter((power) => !state.currentOrders[power]);
}

/** Check if all assigned powers have submitted orders */
export function allOrdersSubmitted(state: GameState): boolean {
	return getPendingPowers(state).length === 0;
}

/** Vote for a draw. Unanimous among all assigned powers = draw. */
export function voteDraw(
	state: GameState,
	power: Power,
): { ok: true; state: GameState; drawAchieved: boolean } | { ok: false; error: string } {
	if (state.status !== 'active') {
		return { ok: false, error: 'Game is not active' };
	}
	if (!state.players.some((p) => p.power === power)) {
		return { ok: false, error: `No player assigned to ${power}` };
	}
	if (state.drawVote.votedPowers.includes(power)) {
		return { ok: false, error: `${power} already voted for a draw` };
	}

	const newVote: DrawVote = {
		votedPowers: [...state.drawVote.votedPowers, power],
	};

	const assignedPowers = state.players.map((p) => p.power).filter((p): p is Power => p !== null);
	const drawAchieved = assignedPowers.every((p) => newVote.votedPowers.includes(p));

	let newState: GameState = { ...state, drawVote: newVote };

	if (drawAchieved) {
		newState = {
			...newState,
			status: 'finished',
			finishedAt: new Date().toISOString(),
			endReason: 'draw',
		};
	}

	return { ok: true, state: newState, drawAchieved };
}

/**
 * Advance the game after adjudication.
 * Updates phase, clears orders, resets draw votes, sets new deadline.
 */
export function advancePhase(
	state: GameState,
	newPhase: string,
	diplomacyState: unknown,
	config: GameConfig = DEFAULT_GAME_CONFIG,
	now = new Date().toISOString(),
): GameState {
	const isMovement = newPhase.endsWith('M');
	const phaseHours = isMovement ? config.movementPhaseHours : config.retreatPhaseHours;
	const deadline = new Date(new Date(now).getTime() + phaseHours * 60 * 60 * 1000).toISOString();

	return {
		...state,
		currentPhase: newPhase,
		currentOrders: {},
		drawVote: { votedPowers: [] },
		phaseDeadline: deadline,
		diplomacyState,
	};
}

/** Mark game as finished with a solo victory */
export function finishGameSoloVictory(
	state: GameState,
	winner: Power,
	now = new Date().toISOString(),
): GameState {
	return {
		...state,
		status: 'finished',
		finishedAt: now,
		endReason: 'solo_victory',
		winner,
	};
}

/** Mark game as abandoned */
export function abandonGame(state: GameState, now = new Date().toISOString()): GameState {
	return {
		...state,
		status: 'finished',
		finishedAt: now,
		endReason: 'abandoned',
	};
}

/** Check if a power has achieved solo victory (18+ supply centers) */
export function checkSoloVictory(centers: Record<string, string[]>): { winner: Power } | null {
	for (const [power, powerCenters] of Object.entries(centers)) {
		if (powerCenters.length >= SOLO_VICTORY_CENTERS) {
			return { winner: power as Power };
		}
	}
	return null;
}

/** Check if the phase deadline has passed */
export function isDeadlinePassed(state: GameState, now = new Date()): boolean {
	if (!state.phaseDeadline) return false;
	return now >= new Date(state.phaseDeadline);
}

/** Get the player assigned to a power */
export function getPlayerForPower(state: GameState, power: Power): Player | undefined {
	return state.players.find((p) => p.power === power);
}

/** Get the power assigned to a player (by DID) */
export function getPowerForPlayer(state: GameState, did: string): Power | null {
	const player = state.players.find((p) => p.did === did);
	return player?.power ?? null;
}

/** Fisher-Yates shuffle — creates a new shuffled array */
function fisherYatesShuffle<T>(arr: T[]): T[] {
	const result = [...arr];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		const temp = result[i];
		result[i] = result[j] as T;
		result[j] = temp as T;
	}
	return result;
}

/** Supply center summary string for a Bluesky post */
export function formatCenterCounts(centers: Record<string, string[]>): string {
	return Object.entries(centers)
		.filter(([_, c]) => c.length > 0)
		.sort((a, b) => b[1].length - a[1].length)
		.map(([power, c]) => `${power}: ${c.length}`)
		.join(' | ');
}
