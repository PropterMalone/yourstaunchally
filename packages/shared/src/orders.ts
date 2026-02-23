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
 *   A MUN B          → build
 *   A MUN D          → disband
 *   F BUL/SC - GRE   → move (with coast specification)
 */
import type { Order, UnitType } from './types.js';

/** Full order regex patterns */
const HOLD_RE = /^([AF]) ([A-Z]{3}(?:\/[NSEW]C)?) H$/;
const MOVE_RE = /^([AF]) ([A-Z]{3}(?:\/[NSEW]C)?) - ([A-Z]{3}(?:\/[NSEW]C)?)(?:\s+VIA)?$/;
const SUPPORT_HOLD_RE = /^([AF]) ([A-Z]{3}(?:\/[NSEW]C)?) S ([AF]) ([A-Z]{3}(?:\/[NSEW]C)?)$/;
const SUPPORT_MOVE_RE =
	/^([AF]) ([A-Z]{3}(?:\/[NSEW]C)?) S ([AF]) ([A-Z]{3}(?:\/[NSEW]C)?) - ([A-Z]{3}(?:\/[NSEW]C)?)$/;
const CONVOY_RE =
	/^([AF]) ([A-Z]{3}(?:\/[NSEW]C)?) C ([AF]) ([A-Z]{3}(?:\/[NSEW]C)?) - ([A-Z]{3}(?:\/[NSEW]C)?)$/;
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

/**
 * Normalize an order string to the format the diplomacy library expects.
 * Uppercases, trims whitespace, normalizes spaces.
 */
export function normalizeOrderString(order: string): string {
	return order.trim().toUpperCase().replace(/\s+/g, ' ');
}
