import { describe, expect, it } from 'vitest';
import { parseDm, parseMention } from './command-parser.js';

describe('parseMention', () => {
	it('parses "new game"', () => {
		expect(parseMention('@yourfriend new game')).toEqual({ type: 'new_game' });
	});

	it('parses "new" alone', () => {
		expect(parseMention('@yourfriend new')).toEqual({ type: 'new_game' });
	});

	it('parses "join #abc123"', () => {
		expect(parseMention('@yourfriend join #abc123')).toEqual({
			type: 'join',
			gameId: 'abc123',
		});
	});

	it('parses "leave #abc123"', () => {
		expect(parseMention('@yourfriend leave #abc123')).toEqual({
			type: 'leave',
			gameId: 'abc123',
		});
	});

	it('parses "start #abc123"', () => {
		expect(parseMention('@yourfriend start #abc123')).toEqual({
			type: 'start',
			gameId: 'abc123',
		});
	});

	it('parses "status #abc123"', () => {
		expect(parseMention('@yourfriend status #abc123')).toEqual({
			type: 'status',
			gameId: 'abc123',
		});
	});

	it('parses "draw #abc123"', () => {
		expect(parseMention('@yourfriend draw #abc123')).toEqual({
			type: 'draw',
			gameId: 'abc123',
		});
	});

	it('parses "abandon #abc123"', () => {
		expect(parseMention('@yourfriend abandon #abc123')).toEqual({
			type: 'abandon',
			gameId: 'abc123',
		});
	});

	it('parses "help"', () => {
		expect(parseMention('@yourfriend help')).toEqual({ type: 'help' });
	});

	it('handles unknown commands', () => {
		const result = parseMention('@yourfriend something weird');
		expect(result.type).toBe('unknown');
	});

	it('is case-insensitive', () => {
		expect(parseMention('@yourfriend JOIN #ABC123')).toEqual({
			type: 'join',
			gameId: 'abc123',
		});
	});

	it('handles extra whitespace', () => {
		expect(parseMention('  @yourfriend   join   #abc123  ')).toEqual({
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

	it('parses "orders" query', () => {
		expect(parseDm('#abc123 orders')).toEqual({ type: 'show_orders', gameId: 'abc123' });
	});

	it('parses "possible" query', () => {
		expect(parseDm('#abc123 possible')).toEqual({ type: 'show_possible', gameId: 'abc123' });
	});

	it('handles unknown DM text', () => {
		expect(parseDm('random text no game id')).toEqual({
			type: 'unknown',
			text: 'random text no game id',
		});
	});

	it('handles game ID with no content', () => {
		expect(parseDm('#abc123')).toEqual({ type: 'unknown', text: '#abc123' });
	});
});
