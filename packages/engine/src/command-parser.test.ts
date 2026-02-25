import { describe, expect, it } from 'vitest';
import { parseDm, parseMention } from './command-parser.js';

describe('parseMention', () => {
	it('parses "new game"', () => {
		expect(parseMention('@yourstaunchally new game')).toEqual({ type: 'new_game' });
	});

	it('parses "new" alone', () => {
		expect(parseMention('@yourstaunchally new')).toEqual({ type: 'new_game' });
	});

	it('parses "join #abc123"', () => {
		expect(parseMention('@yourstaunchally join #abc123')).toEqual({
			type: 'join',
			gameId: 'abc123',
		});
	});

	it('parses "leave #abc123"', () => {
		expect(parseMention('@yourstaunchally leave #abc123')).toEqual({
			type: 'leave',
			gameId: 'abc123',
		});
	});

	it('parses "start #abc123"', () => {
		expect(parseMention('@yourstaunchally start #abc123')).toEqual({
			type: 'start',
			gameId: 'abc123',
		});
	});

	it('parses "status #abc123"', () => {
		expect(parseMention('@yourstaunchally status #abc123')).toEqual({
			type: 'status',
			gameId: 'abc123',
		});
	});

	it('parses "draw #abc123"', () => {
		expect(parseMention('@yourstaunchally draw #abc123')).toEqual({
			type: 'draw',
			gameId: 'abc123',
		});
	});

	it('parses "abandon #abc123"', () => {
		expect(parseMention('@yourstaunchally abandon #abc123')).toEqual({
			type: 'abandon',
			gameId: 'abc123',
		});
	});

	it('parses "claim #id FRANCE"', () => {
		expect(parseMention('@yourstaunchally claim #abc123 FRANCE')).toEqual({
			type: 'claim',
			gameId: 'abc123',
			power: 'FRANCE',
		});
	});

	it('parses claim with lowercase power', () => {
		expect(parseMention('@yourstaunchally claim #abc123 russia')).toEqual({
			type: 'claim',
			gameId: 'abc123',
			power: 'RUSSIA',
		});
	});

	it('parses "help"', () => {
		expect(parseMention('@yourstaunchally help')).toEqual({ type: 'help' });
	});

	it('parses "games"', () => {
		expect(parseMention('@yourstaunchally games')).toEqual({ type: 'games' });
	});

	it('parses "list"', () => {
		expect(parseMention('@yourstaunchally list')).toEqual({ type: 'games' });
	});

	it('handles unknown commands', () => {
		const result = parseMention('@yourstaunchally something weird');
		expect(result.type).toBe('unknown');
	});

	it('is case-insensitive', () => {
		expect(parseMention('@yourstaunchally JOIN #ABC123')).toEqual({
			type: 'join',
			gameId: 'abc123',
		});
	});

	it('handles extra whitespace', () => {
		expect(parseMention('  @yourstaunchally   join   #abc123  ')).toEqual({
			type: 'join',
			gameId: 'abc123',
		});
	});
});

describe('parseDm', () => {
	it('parses order submission', () => {
		const result = parseDm('#abc123 A PAR - BUR; A MAR - SPA; F BRE - MAO');
		expect(result).toEqual({
			type: 'submit_orders',
			gameId: 'abc123',
			orderLines: ['A PAR - BUR', 'A MAR - SPA', 'F BRE - MAO'],
		});
	});

	it('parses newline-separated orders', () => {
		const result = parseDm('#abc123\nA PAR - BUR\nA MAR - SPA');
		expect(result).toEqual({
			type: 'submit_orders',
			gameId: 'abc123',
			orderLines: ['A PAR - BUR', 'A MAR - SPA'],
		});
	});

	it('parses comma-separated orders', () => {
		const result = parseDm('#abc123 A VEN - TYR, A ROM - VEN, F NAP - ION');
		expect(result).toEqual({
			type: 'submit_orders',
			gameId: 'abc123',
			orderLines: ['A VEN - TYR', 'A ROM - VEN', 'F NAP - ION'],
		});
	});

	it('parses "orders" query', () => {
		expect(parseDm('#abc123 orders')).toEqual({ type: 'show_orders', gameId: 'abc123' });
	});

	it('parses "possible" query', () => {
		expect(parseDm('#abc123 possible')).toEqual({ type: 'show_possible', gameId: 'abc123' });
	});

	it('parses "my games" DM', () => {
		expect(parseDm('my games')).toEqual({ type: 'my_games' });
	});

	it('parses "games" DM', () => {
		expect(parseDm('games')).toEqual({ type: 'my_games' });
	});

	it('handles unknown DM text', () => {
		expect(parseDm('random text no game id')).toEqual({
			type: 'unknown',
			text: 'random text no game id',
		});
	});

	it('returns game_menu for bare game ID', () => {
		expect(parseDm('#abc123')).toEqual({ type: 'game_menu', gameId: 'abc123' });
	});

	it('parses "help" DM', () => {
		expect(parseDm('help')).toEqual({ type: 'help' });
	});

	it('parses "?" DM', () => {
		expect(parseDm('?')).toEqual({ type: 'help' });
	});

	it('strips smart quotes from keyword commands', () => {
		expect(parseDm('#abc123 possible\u201D')).toEqual({ type: 'show_possible', gameId: 'abc123' });
		expect(parseDm('#abc123 orders.')).toEqual({ type: 'show_orders', gameId: 'abc123' });
	});

	it('accepts "status" as show_orders alias', () => {
		expect(parseDm('#abc123 status')).toEqual({ type: 'show_orders', gameId: 'abc123' });
	});

	it('accepts "#gameId help" as show_possible', () => {
		expect(parseDm('#abc123 help')).toEqual({ type: 'show_possible', gameId: 'abc123' });
	});
});
