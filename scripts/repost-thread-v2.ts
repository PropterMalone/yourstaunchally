/**
 * Repost game #uetpue thread on new account (yrstalwartally).
 * Combined order format, 61s between posts to avoid spam detection.
 * Updates DB with new post URIs/CIDs and announcement ref.
 */
import { AtpAgent, RichText } from '@atproto/api';
import Database from 'better-sqlite3';
import type { GameState } from '@yourstaunchally/shared';
import { POWERS, formatCenterCounts } from '@yourstaunchally/shared';
import { graphemeLength } from '../packages/engine/src/bot.js';

const DELAY_MS = 61_000;
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

// F1901M results — bounces and failures
const F1901M_RESULTS: Record<string, string[]> = {
	'A BUD': [], 'F ALB': [], 'A SER': [],
	'A YOR': [], 'F NTH': [], 'F NWG': [],
	'F MAO': [], 'A SPA': [], 'A BUR': [],
	'A BER': ['bounce'], 'F HEL': [], 'A SIL': ['bounce'],
	'F ION': [], 'A TYR': ['bounce'], 'A VEN': [],
	'A WAR': [], 'F RUM': [], 'A UKR': [], 'F BOT': [],
	'F CON': [], 'A BUL': ['bounce'], 'A ANK': [],
};

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

async function post(agent: AtpAgent, text: string): Promise<{ uri: string; cid: string }> {
	const rt = new RichText({ text });
	await rt.detectFacets(agent);
	return agent.post({ text: rt.text, facets: rt.facets });
}

async function reply(
	agent: AtpAgent,
	text: string,
	parent: { uri: string; cid: string },
	root: { uri: string; cid: string },
): Promise<{ uri: string; cid: string }> {
	const rt = new RichText({ text });
	await rt.detectFacets(agent);
	return agent.post({
		text: rt.text,
		facets: rt.facets,
		reply: {
			parent: { uri: parent.uri, cid: parent.cid },
			root: { uri: root.uri, cid: root.cid },
		},
	});
}

/** Pack per-power order blocks into as few posts as possible (300 grapheme limit) */
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

async function main() {
	const db = new Database(DB_PATH);
	const row = db.prepare('SELECT state_json FROM games WHERE game_id = ?').get(GAME_ID) as {
		state_json: string;
	};
	const state = JSON.parse(row.state_json) as GameState;

	const identifier = process.env['BSKY_IDENTIFIER'];
	const password = process.env['BSKY_PASSWORD'];
	if (!identifier || !password) throw new Error('set BSKY_IDENTIFIER and BSKY_PASSWORD');

	const agent = new AtpAgent({ service: 'https://bsky.social' });
	await agent.login({ identifier, password });
	const botDid = agent.session?.did as string;
	console.log(`Logged in as ${agent.session?.handle} (${botDid})`);

	function record(p: { uri: string; cid: string }, kind: string, phase: string | null) {
		db.prepare(
			`INSERT OR IGNORE INTO game_posts (uri, cid, game_id, author_did, kind, phase, indexed_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
		).run(p.uri, p.cid, GAME_ID, botDid, kind, phase, Date.now());
	}

	let postNum = 1;
	function log(desc: string) {
		console.log(`[${postNum}] ${desc}`);
		postNum++;
	}

	// === 1: Game start ===
	const powerList = state.players
		.filter((p) => p.power)
		.map((p) => `${p.power}: @${p.handle}`)
		.join('\n');
	const startMsg = `⚔️ Game #${GAME_ID} begins!\n\n${powerList}\n\nPhase: S1901M`;

	log('Game start announcement');
	const announcement = await post(agent, startMsg);
	record(announcement, 'game_start', 'S1901M');
	console.log(`  ${announcement.uri}`);

	// Update announcement ref in DB
	const updated1 = { ...state, announcementPost: announcement };
	db.prepare('UPDATE games SET state_json = ? WHERE game_id = ?').run(
		JSON.stringify(updated1),
		GAME_ID,
	);

	console.log(`  Waiting ${DELAY_MS / 1000}s...`);
	await sleep(DELAY_MS);

	// === 2: S1901M result ===
	const s1901Msg = `📜 Game #${GAME_ID}: Spring 1901 Movement\n\nAll orders resolved — no bounces.\n\nAll powers: 3 centers (Russia: 4)`;
	log('S1901M phase result');
	const s1901Post = await reply(agent, s1901Msg, announcement, announcement);
	record(s1901Post, 'phase', 'S1901M');
	console.log(`  ${s1901Post.uri}`);

	console.log(`  Waiting ${DELAY_MS / 1000}s...`);
	await sleep(DELAY_MS);

	// === 3+: S1901M combined orders ===
	const s1901OrderPosts = packOrderPosts(state, S1901M_ORDERS);
	let parent: { uri: string; cid: string } = s1901Post;
	for (const text of s1901OrderPosts) {
		log('S1901M orders (combined)');
		const p = await reply(agent, text, parent, announcement);
		record(p, 'orders', 'S1901M');
		parent = p;
		console.log(`  ${p.uri}`);
		console.log(`  Waiting ${DELAY_MS / 1000}s...`);
		await sleep(DELAY_MS);
	}

	// === F1901M result ===
	const f1901Centers = state.lastCenters as Record<string, string[]>;
	const centerLine = formatCenterCounts(f1901Centers);
	const f1901Msg = `📜 Game #${GAME_ID}: Fall 1901 Movement\n\nThe autumn campaigns resolve. MUN contested by three powers — all bounce.\n\n${centerLine}`;
	log('F1901M phase result');
	const f1901Post = await reply(agent, f1901Msg, parent, announcement);
	record(f1901Post, 'phase', 'F1901M');
	parent = f1901Post;
	console.log(`  ${f1901Post.uri}`);

	console.log(`  Waiting ${DELAY_MS / 1000}s...`);
	await sleep(DELAY_MS);

	// === F1901M combined orders ===
	const f1901OrderPosts = packOrderPosts(state, F1901M_ORDERS, F1901M_RESULTS);
	for (const text of f1901OrderPosts) {
		log('F1901M orders (combined)');
		const p = await reply(agent, text, parent, announcement);
		record(p, 'orders', 'F1901M');
		parent = p;
		console.log(`  ${p.uri}`);
		console.log(`  Waiting ${DELAY_MS / 1000}s...`);
		await sleep(DELAY_MS);
	}

	// === W1901A current phase ===
	const deadline = state.phaseDeadline ? new Date(state.phaseDeadline).toUTCString() : '?';
	const w1901Msg = `📜 Game #${GAME_ID}: Winter 1901 Adjustments\n\nTime to build.\n\n${centerLine}\n\nDeadline: ${deadline}`;
	log('W1901A current phase');
	const w1901Post = await reply(agent, w1901Msg, parent, announcement);
	record(w1901Post, 'phase', 'W1901A');
	console.log(`  ${w1901Post.uri}`);

	console.log(`\nDone! ${postNum - 1} posts total.`);
}

main().catch((err) => {
	console.error('Fatal:', err);
	process.exit(1);
});
