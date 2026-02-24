import { describe, expect, it } from 'vitest';
import { graphemeLength, splitIntoPosts, truncateToLimit } from './bot.js';

describe('graphemeLength', () => {
	it('counts ASCII correctly', () => {
		expect(graphemeLength('hello')).toBe(5);
	});

	it('counts emoji as single graphemes', () => {
		expect(graphemeLength('⚔️')).toBe(1);
		expect(graphemeLength('👑')).toBe(1);
		expect(graphemeLength('🤝')).toBe(1);
	});

	it('counts combined emoji correctly', () => {
		// Family emoji is one grapheme
		expect(graphemeLength('👨‍👩‍👧‍👦')).toBe(1);
	});
});

describe('truncateToLimit', () => {
	it('returns text unchanged when under limit', () => {
		expect(truncateToLimit('short')).toBe('short');
	});

	it('truncates with ellipsis at limit', () => {
		const text = 'a'.repeat(301);
		const result = truncateToLimit(text);
		expect(graphemeLength(result)).toBe(300);
		expect(result.endsWith('…')).toBe(true);
	});
});

describe('splitIntoPosts', () => {
	it('returns single-element array for short text', () => {
		expect(splitIntoPosts('hello')).toEqual(['hello']);
	});

	it('splits long text at line boundaries', () => {
		const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}: some content here`);
		const text = lines.join('\n');
		const chunks = splitIntoPosts(text);

		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(graphemeLength(chunk)).toBeLessThanOrEqual(300);
		}
	});

	it('adds [n/total] suffix to split posts', () => {
		const text = `${'a'.repeat(150)}\n${'b'.repeat(150)}\n${'c'.repeat(150)}`;
		const chunks = splitIntoPosts(text);

		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks[0]).toMatch(/\[1\/\d+\]$/);
		expect(chunks[chunks.length - 1]).toMatch(/\[\d+\/\d+\]$/);
	});

	it('handles the game start announcement format', () => {
		const text = [
			'⚔️ Game #abc123 begins! Phase: S1901M',
			'',
			'AUSTRIA: @peark.es',
			'ENGLAND: @themlg.bsky.social',
			'FRANCE: @schroedinger.bsky.social',
			'GERMANY: @tonylover.bsky.social',
			'ITALY: @nestor-makflow.bsky.social',
			'RUSSIA: @wtdore.bsky.social',
			'TURKEY: @kingchirp.bsky.social',
			'',
			'Deadline: 1d 23h remaining',
		].join('\n');

		const chunks = splitIntoPosts(text);
		for (const chunk of chunks) {
			expect(graphemeLength(chunk)).toBeLessThanOrEqual(300);
		}
		// All content should be present across chunks
		const joined = chunks.join(' ');
		expect(joined).toContain('AUSTRIA');
		expect(joined).toContain('TURKEY');
		expect(joined).toContain('Deadline');
	});

	it('handles the help text format', () => {
		const helpText = `YourStaunchAlly — Diplomacy on Bluesky

Mention commands:
• new game — Create a game
• join #id — Join
• start #id — Start (2-7 players)
• status #id — Check phase/orders
• draw #id — Vote for draw
• claim #id POWER — Claim unassigned power
• abandon #id — Cancel (creator only)
• games — List active games

DM to submit orders:
#id A PAR - BUR; F BRE - MAO; A MAR S A PAR - BUR

DM queries:
#id possible — See your options
#id orders — See submitted orders

H=hold, -=move, S=support, C=convoy`;

		const chunks = splitIntoPosts(helpText);
		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(graphemeLength(chunk)).toBeLessThanOrEqual(300);
		}
	});

	it('splits very long single line on spaces', () => {
		const text = Array.from({ length: 100 }, () => 'word').join(' ');
		const chunks = splitIntoPosts(text);

		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(graphemeLength(chunk)).toBeLessThanOrEqual(300);
		}
	});

	it('preserves text content across splits', () => {
		const text = `Line A\nLine B\nLine C\n${'x'.repeat(280)}`;
		const chunks = splitIntoPosts(text);
		const recombined = chunks.map((c) => c.replace(/ \[\d+\/\d+\]$/, '')).join('\n');
		expect(recombined).toContain('Line A');
		expect(recombined).toContain('Line B');
		expect(recombined).toContain('Line C');
	});
});
