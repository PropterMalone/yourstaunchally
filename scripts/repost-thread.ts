/**
 * One-time: Recreate game #uetpue thread on yourstalwartally.
 * Posts one at a time with 60s gaps to avoid spam detection.
 * Updates DB with new post URIs/CIDs and announcement ref.
 */
import { AtpAgent, RichText } from '@atproto/api';
import Database from 'better-sqlite3';
import type { GameState } from '@yourstaunchally/shared';
import { POWERS } from '@yourstaunchally/shared';
import { orderReportCommentary } from '../packages/engine/src/commentary.js';

const DELAY_MS = 60_000; // 60s between posts
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

// All orders succeeded (empty results = no bounce/dislodge)
const S1901M_RESULTS: Record<string, string[]> = {
	'A BUD': [], 'A VIE': [], 'F TRI': [],
	'F EDI': [], 'F LON': [], 'A LVP': [],
	'F BRE': [], 'A MAR': [], 'A PAR': [],
	'F KIE': [], 'A BER': [], 'A MUN': [],
	'F NAP': [], 'A ROM': [], 'A VEN': [],
	'A WAR': [], 'A MOS': [], 'F SEV': [], 'F STP/SC': [],
	'F ANK': [], 'A CON': [], 'A SMY': [],
};

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

async function postMessage(agent: AtpAgent, text: string): Promise<{ uri: string; cid: string }> {
	const rt = new RichText({ text });
	await rt.detectFacets(agent);
	const res = await agent.post({
		text: rt.text,
		facets: rt.facets,
	});
	return { uri: res.uri, cid: res.cid };
}

async function replyToPost(
	agent: AtpAgent,
	text: string,
	parentUri: string,
	parentCid: string,
	rootUri: string,
	rootCid: string,
): Promise<{ uri: string; cid: string }> {
	const rt = new RichText({ text });
	await rt.detectFacets(agent);
	const res = await agent.post({
		text: rt.text,
		facets: rt.facets,
		reply: {
			parent: { uri: parentUri, cid: parentCid },
			root: { uri: rootUri, cid: rootCid },
		},
	});
	return { uri: res.uri, cid: res.cid };
}

async function main() {
	const db = new Database(DB_PATH);
	const row = db.prepare("SELECT state_json FROM games WHERE game_id = ?").get(GAME_ID) as { state_json: string };
	const state = JSON.parse(row.state_json) as GameState;

	const identifier = process.env['BSKY_IDENTIFIER'];
	const password = process.env['BSKY_PASSWORD'];
	if (!identifier || !password) throw new Error('set BSKY_IDENTIFIER and BSKY_PASSWORD');

	const agent = new AtpAgent({ service: 'https://bsky.social' });
	await agent.login({ identifier, password });
	const botDid = agent.session?.did as string;
	console.log(`Logged in as ${agent.session?.handle} (${botDid})`);

	const posts: { uri: string; cid: string; kind: string; phase: string | null }[] = [];

	function record(post: { uri: string; cid: string }, kind: string, phase: string | null) {
		posts.push({ ...post, kind, phase });
		db.prepare(`
			INSERT OR IGNORE INTO game_posts (uri, cid, game_id, author_did, kind, phase, indexed_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`).run(post.uri, post.cid, GAME_ID, botDid, kind, phase, Date.now());
	}

	// === Post 1: Game start announcement ===
	const powerList = state.players
		.filter((p) => p.power)
		.map((p) => `${p.power}: @${p.handle}`)
		.join('\n');

	const startMsg = `⚔️ Game #${GAME_ID} begins!\n\n${powerList}\n\nPhase: S1901M`;

	console.log('\n[1/10] Posting game start announcement...');
	const announcement = await postMessage(agent, startMsg);
	record(announcement, 'game_start', 'S1901M');
	console.log(`  Posted: ${announcement.uri}`);

	// Update game state with new announcement post
	const updatedState = { ...state, announcementPost: announcement };
	db.prepare("UPDATE games SET state_json = ? WHERE game_id = ?").run(JSON.stringify(updatedState), GAME_ID);
	console.log('  Updated announcementPost in DB');

	console.log(`  Waiting ${DELAY_MS / 1000}s...`);
	await sleep(DELAY_MS);

	// === Post 2: S1901M phase result ===
	const phaseResultMsg = `📜 Game #${GAME_ID}: Spring 1901 Movement\n\nThe opening moves are in. All orders resolved successfully — no bounces, no dislodgements.\n\nAll powers: 3 centers (Russia: 4)\n\nF1901M now in progress.`;

	console.log('[2/10] Posting S1901M phase result...');
	const phasePost = await replyToPost(agent, phaseResultMsg, announcement.uri, announcement.cid, announcement.uri, announcement.cid);
	record(phasePost, 'phase', 'S1901M');
	console.log(`  Posted: ${phasePost.uri}`);

	console.log(`  Waiting ${DELAY_MS / 1000}s...`);
	await sleep(DELAY_MS);

	// === Posts 3-9: Per-power S1901M order replies ===
	let parent = phasePost;
	let postNum = 3;
	for (const power of POWERS) {
		const orders = S1901M_ORDERS[power];
		if (!orders || orders.length === 0) continue;

		const player = state.players.find((p) => p.power === power);
		const handle = player ? `@${player.handle}` : 'Civil Disorder';
		const flavor = orderReportCommentary(power as any);

		const orderLines: string[] = [];
		for (const order of orders) {
			const parts = order.split(/\s+/);
			const unitKey = `${parts[0]} ${parts[1]}`;
			const results = S1901M_RESULTS[unitKey] ?? [];
			const outcome = results.length > 0 ? ` [${results.join(', ')}]` : '';
			orderLines.push(`  ${order}${outcome}`);
		}

		const text = `${power} (${handle})\n${flavor}\n\n${orderLines.join('\n')}`;

		console.log(`[${postNum}/10] Posting ${power} orders...`);
		const reply = await replyToPost(agent, text, parent.uri, parent.cid, announcement.uri, announcement.cid);
		record(reply, 'orders', 'S1901M');
		parent = reply;
		console.log(`  Posted: ${reply.uri}`);

		postNum++;
		if (postNum <= 10) {
			console.log(`  Waiting ${DELAY_MS / 1000}s...`);
			await sleep(DELAY_MS);
		}
	}

	// === Post 10: F1901M current phase ===
	const deadline = state.phaseDeadline ? new Date(state.phaseDeadline).toUTCString() : '?';
	const f1901Msg = `📜 Game #${GAME_ID}: Fall 1901 Movement\n\nThe autumn campaigns begin. Who honored their spring promises?\n\nAll powers: 3 centers (Russia: 4)\n\nDeadline: ${deadline}`;

	console.log(`[10/10] Posting F1901M phase...`);
	await sleep(DELAY_MS);
	const f1901Post = await replyToPost(agent, f1901Msg, parent.uri, parent.cid, announcement.uri, announcement.cid);
	record(f1901Post, 'phase', 'F1901M');
	console.log(`  Posted: ${f1901Post.uri}`);

	console.log('\n=== Done! ===');
	console.log(`Total posts: ${posts.length}`);
	for (const p of posts) {
		console.log(`  ${p.kind} (${p.phase}): ${p.uri}`);
	}
}

main().catch((err) => {
	console.error('Fatal:', err);
	process.exit(1);
});
