/** All Diplomacy game types. Standard map, 7 powers. */

export const POWERS = [
	'AUSTRIA',
	'ENGLAND',
	'FRANCE',
	'GERMANY',
	'ITALY',
	'RUSSIA',
	'TURKEY',
] as const;

export type Power = (typeof POWERS)[number];

/** Unit type: Army or Fleet */
export type UnitType = 'A' | 'F';

/** A unit on the map, e.g. { type: 'A', province: 'PAR' } */
export interface Unit {
	type: UnitType;
	province: string;
}

/**
 * Phase in the game cycle.
 * Format matches the Python diplomacy library: S1901M, F1901M, etc.
 *
 * Season: S (Spring), F (Fall), W (Winter)
 * Year: 1901+
 * Type: M (Movement), R (Retreats), A (Adjustment/Builds)
 */
export type Season = 'S' | 'F' | 'W';
export type PhaseType = 'M' | 'R' | 'A';

export interface Phase {
	season: Season;
	year: number;
	type: PhaseType;
}

/** Parse phase string like 'S1901M' into structured Phase */
export function parsePhase(phaseStr: string): Phase {
	const match = phaseStr.match(/^([SFW])(\d{4})([MRA])$/);
	if (!match) throw new Error(`parsePhase: invalid phase string "${phaseStr}"`);
	return {
		season: match[1] as Season,
		year: Number(match[2]),
		type: match[3] as PhaseType,
	};
}

/** Serialize Phase back to string */
export function formatPhase(phase: Phase): string {
	return `${phase.season}${phase.year}${phase.type}`;
}

/** Order types that players can submit */
export type OrderType =
	| 'hold'
	| 'move'
	| 'support'
	| 'convoy'
	| 'retreat'
	| 'build'
	| 'disband'
	| 'waive';

/** A parsed order */
export interface Order {
	/** Raw order string in diplomacy library format, e.g. "A PAR - BUR" */
	raw: string;
	type: OrderType;
	unitType: UnitType;
	province: string;
	/** Target province for move/support/convoy */
	target?: string;
	/** For support: the unit being supported */
	supportedUnit?: { type: UnitType; province: string };
	/** For support-move: where the supported unit is going */
	supportTarget?: string;
	/** For convoy: the unit being convoyed */
	convoyedUnit?: { type: UnitType; province: string };
}

/** Game lifecycle states */
export type GameStatus = 'lobby' | 'active' | 'finished';

/** How the game ended */
export type GameEndReason = 'solo_victory' | 'draw' | 'abandoned';

/** A player in a game */
export interface Player {
	did: string;
	handle: string;
	power: Power | null; // null until game starts
	joinedAt: string;
}

/** Orders submitted by a player for the current phase */
export interface PhaseOrders {
	power: Power;
	orders: string[]; // Raw order strings for the diplomacy library
	submittedAt: string;
}

/** Draw vote state */
export interface DrawVote {
	/** Powers that have voted for a draw this phase */
	votedPowers: Power[];
}

/** Result of adjudication from the Python bridge */
export interface AdjudicationResult {
	/** New phase string after processing */
	newPhase: string;
	/** Units per power after resolution */
	units: Record<Power, string[]>;
	/** Supply centers per power after resolution */
	centers: Record<Power, string[]>;
	/** Whether the game is finished */
	isGameDone: boolean;
	/** SVG map of the new state (if requested) */
	svg?: string;
}

/** Full game state — serialized to DB as JSON */
export interface GameState {
	gameId: string;
	status: GameStatus;
	createdAt: string;
	startedAt: string | null;
	finishedAt: string | null;
	endReason: GameEndReason | null;
	winner: Power | null;

	/** Current phase string from diplomacy library, e.g. 'S1901M' */
	currentPhase: string | null;

	/** Player assignments */
	players: Player[];

	/** Current phase orders, keyed by power name */
	currentOrders: Record<string, PhaseOrders>;

	/** Draw vote state for current phase */
	drawVote: DrawVote;

	/** Phase deadline (ISO timestamp). Null in lobby. */
	phaseDeadline: string | null;

	/** Bluesky post references for threading */
	announcementPost: { uri: string; cid: string } | null;

	/** Supply centers per power after last adjudication. Null before first adjudication. */
	lastCenters: Record<string, string[]> | null;

	/** Units per power after last adjudication. Null before first adjudication. */
	lastUnits: Record<string, string[]> | null;

	/**
	 * Serialized game state from the Python diplomacy library.
	 * Opaque to TypeScript — passed back to Python for adjudication.
	 */
	diplomacyState: unknown;
}

/** Configuration for game timing */
export interface GameConfig {
	/** Movement phase duration in hours (default: 48) */
	movementPhaseHours: number;
	/** Retreat/adjustment phase duration in hours (default: 24) */
	retreatPhaseHours: number;
	/** Minimum players to start (default: 3) */
	minPlayers: number;
	/** Maximum players (always 7) */
	maxPlayers: number;
}

export const DEFAULT_GAME_CONFIG: GameConfig = {
	movementPhaseHours: 48,
	retreatPhaseHours: 24,
	minPlayers: 2,
	maxPlayers: 7,
};

/** Supply center count needed for solo victory */
export const SOLO_VICTORY_CENTERS = 18;
