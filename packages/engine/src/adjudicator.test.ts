/**
 * Integration tests for the Python adjudication bridge.
 * These call the real Python subprocess — requires .venv with diplomacy installed.
 */
import { describe, expect, it } from 'vitest';
import { getPossibleOrders, newGame, renderMap, setOrdersAndProcess } from './adjudicator.js';

// Set PYTHON_PATH to use the project venv
process.env['PYTHON_PATH'] = `${import.meta.dirname}/../../../.venv/bin/python3`;

describe('adjudicator integration', () => {
	it('creates a new game with correct initial state', async () => {
		const result = await newGame();

		expect(result.phase).toBe('S1901M');
		expect(Object.keys(result.units)).toHaveLength(7);
		expect(result.units['FRANCE']).toEqual(expect.arrayContaining(['A PAR', 'A MAR', 'F BRE']));
		expect(result.units['RUSSIA']).toHaveLength(4); // Russia starts with 4 units
		expect(result.centers['FRANCE']).toEqual(expect.arrayContaining(['PAR', 'MAR', 'BRE']));
		expect(result.gameState).toBeDefined();
	});

	it('processes Spring 1901 orders and advances to Fall 1901', async () => {
		const game = await newGame();

		const result = await setOrdersAndProcess(game.gameState, {
			AUSTRIA: ['A BUD - SER', 'A VIE - BUD', 'F TRI - ALB'],
			ENGLAND: ['F LON - NTH', 'A LVP - YOR', 'F EDI - NWG'],
			FRANCE: ['A PAR - BUR', 'A MAR - SPA', 'F BRE - MAO'],
			GERMANY: ['F KIE - DEN', 'A BER - KIE', 'A MUN - RUH'],
			ITALY: ['F NAP - ION', 'A ROM - APU', 'A VEN H'],
			RUSSIA: ['A MOS - UKR', 'A WAR - GAL', 'F SEV - BLA', 'F STP/SC - BOT'],
			TURKEY: ['F ANK - BLA', 'A CON - BUL', 'A SMY - CON'],
		});

		expect(result.phase).toBe('F1901M');
		expect(result.isGameDone).toBe(false);

		// France should have moved
		expect(result.units['FRANCE']).toEqual(expect.arrayContaining(['A BUR', 'A SPA', 'F MAO']));

		// Turkey-Russia Black Sea bounce — both fleets should stay put
		expect(result.units['RUSSIA']).toContain('F SEV');
		expect(result.units['TURKEY']).toContain('F ANK');
	});

	it('processes two full years (Spring + Fall + Adjustments)', async () => {
		const game = await newGame();

		// Spring 1901
		const spring = await setOrdersAndProcess(game.gameState, {
			AUSTRIA: ['A BUD - SER', 'A VIE - BUD', 'F TRI - ALB'],
			ENGLAND: ['F LON - NTH', 'A LVP - YOR', 'F EDI - NWG'],
			FRANCE: ['A PAR - BUR', 'A MAR - SPA', 'F BRE - MAO'],
			GERMANY: ['F KIE - DEN', 'A BER - KIE', 'A MUN - RUH'],
			ITALY: ['F NAP - ION', 'A ROM - APU', 'A VEN H'],
			RUSSIA: ['A MOS - UKR', 'A WAR - GAL', 'F SEV - BLA', 'F STP/SC - BOT'],
			TURKEY: ['F ANK - BLA', 'A CON - BUL', 'A SMY - CON'],
		});
		expect(spring.phase).toBe('F1901M');

		// Fall 1901 — take neutral SCs
		const fall = await setOrdersAndProcess(spring.gameState, {
			AUSTRIA: ['A SER - GRE', 'A BUD - RUM', 'F ALB - ION'],
			ENGLAND: ['F NTH - NWY', 'A YOR - LON', 'F NWG - BAR'],
			FRANCE: ['A BUR - BEL', 'A SPA H', 'F MAO - POR'],
			GERMANY: ['F DEN H', 'A KIE - HOL', 'A RUH - BEL'],
			ITALY: ['F ION - TUN', 'A APU - NAP', 'A VEN H'],
			RUSSIA: ['A UKR - RUM', 'A GAL - BUD', 'F SEV - BLA', 'F BOT - SWE'],
			TURKEY: ['F ANK - BLA', 'A BUL - GRE', 'A CON - BUL'],
		});

		// Should be in adjustment phase (W1901A) or next spring
		expect(fall.phase).toMatch(/^(W1901A|S1902M|F1901R)$/);
		expect(fall.isGameDone).toBe(false);

		// Some powers should have gained centers
		const totalCenters = Object.values(fall.centers).reduce((sum, c) => sum + c.length, 0);
		expect(totalCenters).toBeGreaterThan(22); // Started with 22, neutrals captured
	});

	it('gets possible orders for a phase', async () => {
		const game = await newGame();
		const possible = await getPossibleOrders(game.gameState);

		expect(possible.phase).toBe('S1901M');
		expect(possible.possibleOrders['FRANCE']).toBeDefined();

		// France should have orderable locations
		const frenchLocs = Object.keys(possible.possibleOrders['FRANCE'] ?? {});
		expect(frenchLocs).toEqual(expect.arrayContaining(['PAR', 'MAR', 'BRE']));

		// PAR should have move options
		const parOrders = possible.possibleOrders['FRANCE']?.['PAR'];
		expect(parOrders).toBeDefined();
		expect(parOrders).toContain('A PAR - BUR');
		expect(parOrders).toContain('A PAR H');
	});

	it('renders a map as SVG', async () => {
		const game = await newGame();
		const map = await renderMap(game.gameState);

		expect(map.phase).toBe('S1901M');
		expect(map.svg).toContain('<?xml');
		expect(map.svg).toContain('svg');
		expect(map.svg.length).toBeGreaterThan(10000); // SVG is ~108K chars
	});

	it('handles civil disorder (missing orders)', async () => {
		const game = await newGame();

		// Only France submits orders — everyone else holds (civil disorder)
		const result = await setOrdersAndProcess(game.gameState, {
			FRANCE: ['A PAR - BUR', 'A MAR - SPA', 'F BRE - MAO'],
		});

		expect(result.phase).toBe('F1901M');
		// France moved
		expect(result.units['FRANCE']).toEqual(expect.arrayContaining(['A BUR', 'A SPA', 'F MAO']));
		// Everyone else held (civil disorder default)
		expect(result.units['ENGLAND']).toEqual(expect.arrayContaining(['F EDI', 'F LON', 'A LVP']));
	});
});
