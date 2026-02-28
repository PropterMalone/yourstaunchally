/**
 * Order string parsing and validation.
 *
 * Parses human-readable order strings into structured Order objects.
 * Order format follows the diplomacy library conventions:
 *   A PAR H          → hold
 *   A PAR - BUR      → move
 *   A MAR S A PAR    → support hold
 *   A MAR S A PAR - BUR → support move
 *   F MAO C A BRE - SPA → convoy
 *   A BUR R PAR      → retreat
 *   A MUN B          → build
 *   A MUN D          → disband
 *   F BUL/SC - GRE   → move (with coast specification)
 */
import type { Order, UnitType } from './types.js';

/** Full order regex patterns */
const HOLD_RE = /^([AF]) ([A-Z]{3}(?:\/[NSEW]C)?) H$/;
const MOVE_RE = /^([AF]) ([A-Z]{3}(?:\/[NSEW]C)?) - ([A-Z]{3}(?:\/[NSEW]C)?)(?:\s+VIA)?$/;
const SUPPORT_HOLD_RE =
	/^([AF]) ([A-Z]{3}(?:\/[NSEW]C)?) S ([AF]) ([A-Z]{3}(?:\/[NSEW]C)?)(?: H)?$/;
const SUPPORT_MOVE_RE =
	/^([AF]) ([A-Z]{3}(?:\/[NSEW]C)?) S ([AF]) ([A-Z]{3}(?:\/[NSEW]C)?) - ([A-Z]{3}(?:\/[NSEW]C)?)$/;
const CONVOY_RE =
	/^([AF]) ([A-Z]{3}(?:\/[NSEW]C)?) C ([AF]) ([A-Z]{3}(?:\/[NSEW]C)?) - ([A-Z]{3}(?:\/[NSEW]C)?)$/;
const RETREAT_RE = /^([AF]) ([A-Z]{3}(?:\/[NSEW]C)?) R ([A-Z]{3}(?:\/[NSEW]C)?)$/;
const BUILD_RE = /^([AF]) ([A-Z]{3}(?:\/[NSEW]C)?) B$/;
const DISBAND_RE = /^([AF]) ([A-Z]{3}(?:\/[NSEW]C)?) D$/;

export type ParseOrderResult = { ok: true; order: Order } | { ok: false; error: string };

/** Extract a regex capture group — guaranteed present when the regex matched */
function g(match: RegExpMatchArray, index: number): string {
	return match[index] ?? '';
}

/** Parse a single order string into an Order object */
export function parseOrder(raw: string): ParseOrderResult {
	const trimmed = raw.trim().toUpperCase();

	let match: RegExpMatchArray | null;

	// Hold: A PAR H
	match = trimmed.match(HOLD_RE);
	if (match) {
		return {
			ok: true,
			order: {
				raw: trimmed,
				type: 'hold',
				unitType: g(match, 1) as UnitType,
				province: g(match, 2),
			},
		};
	}

	// Support move: A MAR S A PAR - BUR (must check before support hold)
	match = trimmed.match(SUPPORT_MOVE_RE);
	if (match) {
		return {
			ok: true,
			order: {
				raw: trimmed,
				type: 'support',
				unitType: g(match, 1) as UnitType,
				province: g(match, 2),
				supportedUnit: { type: g(match, 3) as UnitType, province: g(match, 4) },
				supportTarget: g(match, 5),
			},
		};
	}

	// Support hold: A MAR S A PAR
	match = trimmed.match(SUPPORT_HOLD_RE);
	if (match) {
		return {
			ok: true,
			order: {
				raw: trimmed,
				type: 'support',
				unitType: g(match, 1) as UnitType,
				province: g(match, 2),
				supportedUnit: { type: g(match, 3) as UnitType, province: g(match, 4) },
			},
		};
	}

	// Convoy: F MAO C A BRE - SPA
	match = trimmed.match(CONVOY_RE);
	if (match) {
		return {
			ok: true,
			order: {
				raw: trimmed,
				type: 'convoy',
				unitType: g(match, 1) as UnitType,
				province: g(match, 2),
				target: g(match, 5),
				convoyedUnit: { type: g(match, 3) as UnitType, province: g(match, 4) },
			},
		};
	}

	// Move: A PAR - BUR
	match = trimmed.match(MOVE_RE);
	if (match) {
		return {
			ok: true,
			order: {
				raw: trimmed,
				type: 'move',
				unitType: g(match, 1) as UnitType,
				province: g(match, 2),
				target: g(match, 3),
			},
		};
	}

	// Retreat: A BUR R PAR
	match = trimmed.match(RETREAT_RE);
	if (match) {
		return {
			ok: true,
			order: {
				raw: trimmed,
				type: 'retreat',
				unitType: g(match, 1) as UnitType,
				province: g(match, 2),
				target: g(match, 3),
			},
		};
	}

	// Build: A MUN B
	match = trimmed.match(BUILD_RE);
	if (match) {
		return {
			ok: true,
			order: {
				raw: trimmed,
				type: 'build',
				unitType: g(match, 1) as UnitType,
				province: g(match, 2),
			},
		};
	}

	// Disband: A MUN D
	match = trimmed.match(DISBAND_RE);
	if (match) {
		return {
			ok: true,
			order: {
				raw: trimmed,
				type: 'disband',
				unitType: g(match, 1) as UnitType,
				province: g(match, 2),
			},
		};
	}

	// Waive: WAIVE (skip a build)
	if (trimmed === 'WAIVE') {
		return {
			ok: true,
			order: { raw: 'WAIVE', type: 'waive', unitType: 'A' as UnitType, province: '' },
		};
	}

	return { ok: false, error: `Unrecognized order format: "${raw}"` };
}

/**
 * Parse multiple order lines (one per line or semicolon-separated).
 * Skips blank lines. Returns all results (success or failure).
 */
export function parseOrders(input: string): ParseOrderResult[] {
	return input
		.split(/[;\n]/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map(parseOrder);
}

/** Bicoastal provinces and which sea locations border each coast.
 *  Used to auto-infer coast when a fleet targets SPA/BUL/STP without specifying. */
const COAST_ADJACENCIES: Record<string, Record<string, string[]>> = {
	SPA: {
		'/NC': ['GAS', 'MAO', 'POR'],
		'/SC': ['LYO', 'MAO', 'MAR', 'POR', 'WES'],
	},
	BUL: {
		'/SC': ['AEG', 'CON', 'GRE'],
		'/EC': ['BLA', 'CON', 'RUM'],
	},
	STP: {
		'/NC': ['BAR', 'NWY'],
		'/SC': ['BOT', 'FIN', 'LVN'],
	},
};

/** If a fleet move targets a bicoastal province without a coast, try to infer it.
 *  Returns the coast suffix ("/NC", "/SC", "/EC") if exactly one coast is reachable,
 *  null if ambiguous or not applicable. */
export function inferCoast(source: string, destination: string): string | null {
	const coasts = COAST_ADJACENCIES[destination];
	if (!coasts) return null; // not a bicoastal province
	const reachable = Object.entries(coasts).filter(([_, locs]) => locs.includes(source));
	if (reachable.length === 1) return reachable[0]?.[0] ?? null;
	return null; // ambiguous (0 or 2 matches)
}

/**
 * Normalize an order string to the format the diplomacy library expects.
 * Uppercases, trims whitespace, normalizes spaces.
 * Auto-infers coast for fleet moves to bicoastal provinces when unambiguous.
 */
export function normalizeOrderString(order: string): string {
	let normalized = order
		.trim()
		.toUpperCase()
		.replace(/\s+/g, ' ')
		// Strip accidental leading game ID: "#UETPUE A PAR H" → "A PAR H"
		.replace(/^#[A-Z0-9]{4,8}\s+/, '');

	// "WAIVE BRE", "BRE WAIVE", "WAIVE 2" → "WAIVE"
	// Note: "WAIVE N" count expansion is handled by expandWaives(), not here.
	if (/^WAIVE\b/.test(normalized) || /\bWAIVE$/.test(normalized)) return 'WAIVE';

	normalized = normalized
		.replace(/\s*-\s*/g, ' - ')
		.replace(/\(VIA CONVOY\)/, 'VIA')
		// Strip trailing H from support-hold: "A MAR S A PAR H" → "A MAR S A PAR"
		.replace(/^([AF] [A-Z]{3}(?:\/[NSEW]C)? S [AF] [A-Z]{3}(?:\/[NSEW]C)?) H$/, '$1')
		// Normalize trailing R: "F HOL - HEL R" → "F HOL R HEL"
		.replace(/^([AF] [A-Z]{3}(?:\/[NSEW]C)?) - ([A-Z]{3}(?:\/[NSEW]C)?) R$/, '$1 R $2')
		// Normalize "RETREAT" keyword: "F HOL RETREAT HEL" → "F HOL R HEL"
		.replace(/^([AF] [A-Z]{3}(?:\/[NSEW]C)?) RETREAT ([A-Z]{3}(?:\/[NSEW]C)?)$/, '$1 R $2');

	// Auto-infer coast for fleet moves: "F MAO - SPA" → "F MAO - SPA/NC" (if unambiguous)
	const moveMatch = normalized.match(/^F ([A-Z]{3}(?:\/[NSEW]C)?) - ([A-Z]{3})$/);
	if (moveMatch) {
		const source = (moveMatch[1] ?? '').replace(/\/[NSEW]C$/, ''); // strip coast from source
		const dest = moveMatch[2] ?? '';
		const coast = inferCoast(source, dest);
		if (coast) {
			normalized = normalized.replace(/ - [A-Z]{3}$/, ` - ${dest}${coast}`);
		}
	}

	return normalized;
}

/**
 * Convert move-syntax orders to retreat-syntax during retreat phases.
 * Players intuitively write "F HOL - HEL" during retreats — the dash means
 * "move to" in their mental model. This converts it to "F HOL R HEL" which
 * the diplomacy library expects.
 */
export function convertMovesToRetreats(orders: string[], phase: string): string[] {
	if (!phase.endsWith('R')) return orders;
	return orders.map((o) =>
		o.replace(/^([AF] [A-Z]{3}(?:\/[NSEW]C)?) - ([A-Z]{3}(?:\/[NSEW]C)?)$/, '$1 R $2'),
	);
}

/**
 * Expand "WAIVE N" shorthand into N separate WAIVE orders.
 * Call on raw order lines (before or after normalizeOrderString).
 * e.g. ["F MAR B", "WAIVE 2"] → ["F MAR B", "WAIVE", "WAIVE"]
 */
export function expandWaives(orderLines: string[]): string[] {
	return orderLines.flatMap((line) => {
		const upper = line.trim().toUpperCase();
		const match = upper.match(/^WAIVE\s+(\d+)$/);
		if (match) {
			const count = Math.min(Number(match[1]), 20); // cap at 20 to prevent abuse
			return Array.from({ length: count }, () => 'WAIVE');
		}
		return [line];
	});
}
