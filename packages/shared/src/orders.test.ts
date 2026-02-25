import { describe, expect, it } from 'vitest';
import { inferCoast, normalizeOrderString, parseOrder, parseOrders } from './orders.js';

describe('parseOrder', () => {
	it('parses hold orders', () => {
		const result = parseOrder('A PAR H');
		expect(result).toEqual({
			ok: true,
			order: { raw: 'A PAR H', type: 'hold', unitType: 'A', province: 'PAR' },
		});
	});

	it('parses fleet hold', () => {
		const result = parseOrder('F BRE H');
		expect(result).toEqual({
			ok: true,
			order: { raw: 'F BRE H', type: 'hold', unitType: 'F', province: 'BRE' },
		});
	});

	it('parses move orders', () => {
		const result = parseOrder('A PAR - BUR');
		expect(result).toEqual({
			ok: true,
			order: { raw: 'A PAR - BUR', type: 'move', unitType: 'A', province: 'PAR', target: 'BUR' },
		});
	});

	it('parses move with coast', () => {
		const result = parseOrder('F BUL/SC - GRE');
		expect(result).toEqual({
			ok: true,
			order: {
				raw: 'F BUL/SC - GRE',
				type: 'move',
				unitType: 'F',
				province: 'BUL/SC',
				target: 'GRE',
			},
		});
	});

	it('parses move with VIA (convoy route)', () => {
		const result = parseOrder('A BUR - PAR VIA');
		expect(result).toEqual({
			ok: true,
			order: {
				raw: 'A BUR - PAR VIA',
				type: 'move',
				unitType: 'A',
				province: 'BUR',
				target: 'PAR',
			},
		});
	});

	it('parses support hold', () => {
		const result = parseOrder('A MAR S A PAR');
		expect(result).toEqual({
			ok: true,
			order: {
				raw: 'A MAR S A PAR',
				type: 'support',
				unitType: 'A',
				province: 'MAR',
				supportedUnit: { type: 'A', province: 'PAR' },
			},
		});
	});

	it('parses support move', () => {
		const result = parseOrder('A MAR S A PAR - BUR');
		expect(result).toEqual({
			ok: true,
			order: {
				raw: 'A MAR S A PAR - BUR',
				type: 'support',
				unitType: 'A',
				province: 'MAR',
				supportedUnit: { type: 'A', province: 'PAR' },
				supportTarget: 'BUR',
			},
		});
	});

	it('parses convoy', () => {
		const result = parseOrder('F MAO C A BRE - SPA');
		expect(result).toEqual({
			ok: true,
			order: {
				raw: 'F MAO C A BRE - SPA',
				type: 'convoy',
				unitType: 'F',
				province: 'MAO',
				target: 'SPA',
				convoyedUnit: { type: 'A', province: 'BRE' },
			},
		});
	});

	it('parses build', () => {
		const result = parseOrder('A MUN B');
		expect(result).toEqual({
			ok: true,
			order: { raw: 'A MUN B', type: 'build', unitType: 'A', province: 'MUN' },
		});
	});

	it('parses disband', () => {
		const result = parseOrder('A MUN D');
		expect(result).toEqual({
			ok: true,
			order: { raw: 'A MUN D', type: 'disband', unitType: 'A', province: 'MUN' },
		});
	});

	it('handles lowercase input', () => {
		const result = parseOrder('a par - bur');
		expect(result).toEqual({
			ok: true,
			order: {
				raw: 'A PAR - BUR',
				type: 'move',
				unitType: 'A',
				province: 'PAR',
				target: 'BUR',
			},
		});
	});

	it('returns error for invalid input', () => {
		const result = parseOrder('INVALID');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain('Unrecognized');
		}
	});

	it('returns error for empty input', () => {
		const result = parseOrder('');
		expect(result.ok).toBe(false);
	});

	it('parses coast specifications on STP', () => {
		const result = parseOrder('F STP/SC - BOT');
		expect(result).toEqual({
			ok: true,
			order: {
				raw: 'F STP/SC - BOT',
				type: 'move',
				unitType: 'F',
				province: 'STP/SC',
				target: 'BOT',
			},
		});
	});
});

describe('parseOrders', () => {
	it('parses multiple orders separated by newlines', () => {
		const results = parseOrders('A PAR - BUR\nA MAR - SPA\nF BRE - MAO');
		expect(results).toHaveLength(3);
		expect(results.every((r) => r.ok)).toBe(true);
	});

	it('parses semicolon-separated orders', () => {
		const results = parseOrders('A PAR - BUR; A MAR - SPA');
		expect(results).toHaveLength(2);
		expect(results.every((r) => r.ok)).toBe(true);
	});

	it('skips blank lines', () => {
		const results = parseOrders('A PAR - BUR\n\n\nA MAR - SPA');
		expect(results).toHaveLength(2);
	});

	it('returns errors for invalid orders among valid ones', () => {
		const results = parseOrders('A PAR - BUR\nGARBAGE\nA MAR H');
		expect(results).toHaveLength(3);
		expect(results[0]?.ok).toBe(true);
		expect(results[1]?.ok).toBe(false);
		expect(results[2]?.ok).toBe(true);
	});
});

describe('normalizeOrderString', () => {
	it('uppercases and trims', () => {
		expect(normalizeOrderString('  a par - bur  ')).toBe('A PAR - BUR');
	});

	it('collapses multiple spaces', () => {
		expect(normalizeOrderString('A  PAR   -   BUR')).toBe('A PAR - BUR');
	});

	it('normalizes missing spaces around dashes', () => {
		expect(normalizeOrderString('A MUN -SIL')).toBe('A MUN - SIL');
		expect(normalizeOrderString('A MUN- SIL')).toBe('A MUN - SIL');
		expect(normalizeOrderString('A MUN-SIL')).toBe('A MUN - SIL');
	});

	it('auto-infers coast for unambiguous fleet moves', () => {
		expect(normalizeOrderString('F GAS - SPA')).toBe('F GAS - SPA/NC');
		expect(normalizeOrderString('F LYO - SPA')).toBe('F LYO - SPA/SC');
		expect(normalizeOrderString('F BAR - STP')).toBe('F BAR - STP/NC');
		expect(normalizeOrderString('F BOT - STP')).toBe('F BOT - STP/SC');
		expect(normalizeOrderString('F AEG - BUL')).toBe('F AEG - BUL/SC');
		expect(normalizeOrderString('F BLA - BUL')).toBe('F BLA - BUL/EC');
	});

	it('leaves ambiguous coast moves alone', () => {
		expect(normalizeOrderString('F MAO - SPA')).toBe('F MAO - SPA');
		expect(normalizeOrderString('F CON - BUL')).toBe('F CON - BUL');
		expect(normalizeOrderString('F POR - SPA')).toBe('F POR - SPA');
	});

	it('does not modify army orders to coastal provinces', () => {
		expect(normalizeOrderString('A GAS - SPA')).toBe('A GAS - SPA');
	});

	it('does not modify fleet orders with explicit coast', () => {
		expect(normalizeOrderString('F MAO - SPA/NC')).toBe('F MAO - SPA/NC');
	});

	it('normalizes "(via convoy)" to VIA', () => {
		expect(normalizeOrderString('A YOR - DEN (via convoy)')).toBe('A YOR - DEN VIA');
	});
});

describe('inferCoast', () => {
	it('returns coast for unambiguous sources', () => {
		expect(inferCoast('GAS', 'SPA')).toBe('/NC');
		expect(inferCoast('WES', 'SPA')).toBe('/SC');
		expect(inferCoast('MAR', 'SPA')).toBe('/SC');
		expect(inferCoast('AEG', 'BUL')).toBe('/SC');
		expect(inferCoast('BLA', 'BUL')).toBe('/EC');
		expect(inferCoast('RUM', 'BUL')).toBe('/EC');
		expect(inferCoast('GRE', 'BUL')).toBe('/SC');
		expect(inferCoast('BAR', 'STP')).toBe('/NC');
		expect(inferCoast('NWY', 'STP')).toBe('/NC');
		expect(inferCoast('BOT', 'STP')).toBe('/SC');
		expect(inferCoast('FIN', 'STP')).toBe('/SC');
	});

	it('returns null for ambiguous sources', () => {
		expect(inferCoast('MAO', 'SPA')).toBeNull();
		expect(inferCoast('POR', 'SPA')).toBeNull();
		expect(inferCoast('CON', 'BUL')).toBeNull();
	});

	it('returns null for non-coastal destinations', () => {
		expect(inferCoast('MAO', 'BRE')).toBeNull();
		expect(inferCoast('PAR', 'BUR')).toBeNull();
	});
});
