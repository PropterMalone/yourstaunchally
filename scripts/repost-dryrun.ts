/** Dry-run: count how many posts the repost will produce */
import Database from 'better-sqlite3';
import type { GameState } from '@yourstaunchally/shared';
import { POWERS } from '@yourstaunchally/shared';
import { graphemeLength } from '../packages/engine/src/bot.js';

const GAME_ID = 'uetpue';
const DB_PATH = './data/yourstaunchally.db';

const S1901M_ORDERS: Record<string, string[]> = {
	AUSTRIA: ['A BUD - SER', 'F TRI - ALB', 'A VIE - BUD'],
	ENGLAND: ['F EDI - NWG', 'F LON - NTH', 'A LVP - YOR'],
	FRANCE: ['F BRE - MAO', 'A MAR - SPA', 'A PAR - BUR'],
	GERMANY: ['A BER S A MUN - SIL', 'A MUN - SIL', 'F KIE - HEL'],
	ITALY: ['A VEN - TYR', 'A ROM - VEN', 'F NAP - ION'],
	RUSSIA: ['A WAR H', 'F STP/SC - BOT', 'A MOS - UKR', 'F SEV - RUM'],
	TURKEY: ['A CON - BUL', 'F ANK - CON', 'A SMY - ANK'],
};

const F1901M_ORDERS: Record<string, string[]> = {
	AUSTRIA: ['A BUD - TRI', 'F ALB - GRE', 'A SER S F ALB - GRE'],
	ENGLAND: ['A YOR - DEN VIA', 'F NTH C A YOR - DEN', 'F NWG - NWY'],
	FRANCE: ['F MAO - POR', 'A SPA H', 'A BUR - BEL'],
	GERMANY: ['A BER - MUN', 'F HEL - HOL', 'A SIL - MUN'],
	ITALY: ['F ION - TUN', 'A TYR - MUN', 'A VEN H'],
	RUSSIA: ['A WAR H', 'F RUM H', 'A UKR S F RUM', 'F BOT - SWE'],
	TURKEY: ['F CON - AEG', 'A BUL - GRE', 'A ANK - CON'],
};

const F1901M_RESULTS: Record<string, string[]> = {
	'A BUD': [], 'F ALB': [], 'A SER': [],
	'A YOR': [], 'F NTH': [], 'F NWG': [],
	'F MAO': [], 'A SPA': [], 'A BUR': [],
	'A BER': ['bounce'], 'F HEL': [], 'A SIL': ['bounce'],
	'F ION': [], 'A TYR': ['bounce'], 'A VEN': [],
	'A WAR': [], 'F RUM': [], 'A UKR': [], 'F BOT': [],
	'F CON': [], 'A BUL': ['bounce'], 'A ANK': [],
};

function packOrderPosts(
	state: GameState,
	orders: Record<string, string[]>,
	results?: Record<string, string[]>,
): string[] {
	const POST_LIMIT = 300;
	const blocks: string[] = [];
	for (const power of POWERS) {
		const powerOrders = orders[power];
		if (!powerOrders || powerOrders.length === 0) continue;
		const player = state.players.find((p) => p.power === power);
		const handle = player ? `@${player.handle}` : 'Civil Disorder';
		const lines: string[] = [];
		for (const order of powerOrders) {
			const parts = order.split(/\s+/);
			const unitKey = `${parts[0]} ${parts[1]}`;
			const res = results?.[unitKey] ?? [];
			const outcome = res.length > 0 ? ` [${res.join(', ')}]` : '';
			lines.push(`  ${order}${outcome}`);
		}
		blocks.push(`${power} (${handle})\n${lines.join('\n')}`);
	}
	const posts: string[] = [];
	let current = '';
	for (const block of blocks) {
		const sep = current ? '\n\n' : '';
		const combined = current + sep + block;
		if (graphemeLength(combined) <= POST_LIMIT) {
			current = combined;
		} else {
			if (current) posts.push(current);
			current = block;
		}
	}
	if (current) posts.push(current);
	return posts;
}

const db = new Database(DB_PATH, { readonly: true });
const row = db.prepare('SELECT state_json FROM games WHERE game_id = ?').get(GAME_ID) as { state_json: string };
const state = JSON.parse(row.state_json) as GameState;

const s1901Posts = packOrderPosts(state, S1901M_ORDERS);
const f1901Posts = packOrderPosts(state, F1901M_ORDERS, F1901M_RESULTS);

console.log(`S1901M orders: ${s1901Posts.length} post(s)`);
for (const [i, p] of s1901Posts.entries()) {
	console.log(`  [${i + 1}] ${graphemeLength(p)} graphemes`);
	console.log(p);
	console.log('---');
}
console.log(`F1901M orders: ${f1901Posts.length} post(s)`);
for (const [i, p] of f1901Posts.entries()) {
	console.log(`  [${i + 1}] ${graphemeLength(p)} graphemes`);
	console.log(p);
	console.log('---');
}

const totalPosts = 1 + 1 + s1901Posts.length + 1 + f1901Posts.length + 1; // start + s1901 + orders + f1901 + orders + w1901
console.log(`\nTotal posts: ${totalPosts}`);
console.log(`Time: ~${Math.round(totalPosts * 61 / 60)} minutes`);
