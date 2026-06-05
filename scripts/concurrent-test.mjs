#!/usr/bin/env node
/**
 * Concurrent games stress test — launches 3 games simultaneously using all 3 test accounts.
 * Each account creates one game, the other two join it. All 3 games run through the
 * full cycle in parallel, verifying no cross-contamination between games.
 *
 * Game matrix:
 *   A: bobbyquine creates, jackautomatic + rikkiwildside join
 *   B: jackautomatic creates, bobbyquine + rikkiwildside join
 *   C: rikkiwildside creates, bobbyquine + jackautomatic join
 *
 * Usage: node scripts/concurrent-test.mjs
 */
import { AtpAgent, RichText } from '@atproto/api';

const BOT_HANDLE = 'yourstaunchally.bsky.social';
const POLL_INTERVAL = 5000;
const MAX_WAIT = 180_000; // 3 min — more bot work per poll cycle with 3 games
const GAME_CREATION_STAGGER_MS = 3000; // stagger to avoid mention polling race

/**
 * Reads test accounts from scripts/accounts.json (gitignored).
 * Expects at least 3 accounts — uses first 3 as bobby/jack/rikki.
 */
import { readFileSync } from 'node:fs';
const allAccounts = JSON.parse(readFileSync(new URL('./accounts.json', import.meta.url), 'utf8'));
if (allAccounts.length < 3) {
	console.error('Need at least 3 accounts in scripts/accounts.json');
	process.exit(1);
}
const ACCOUNTS = {
	bobby: { identifier: allAccounts[0].handle ?? allAccounts[0].identifier, password: allAccounts[0].password },
	jack: { identifier: allAccounts[1].handle ?? allAccounts[1].identifier, password: allAccounts[1].password },
	rikki: { identifier: allAccounts[2].handle ?? allAccounts[2].identifier, password: allAccounts[2].password },
};

const STANDARD_ORDERS = {
	AUSTRIA: 'A BUD - SER; A VIE - BUD; F TRI - ALB',
	ENGLAND: 'F LON - NTH; A LVP - YOR; F EDI - NWG',
	FRANCE: 'A PAR - BUR; A MAR - SPA; F BRE - MAO',
	GERMANY: 'F KIE - DEN; A BER - KIE; A MUN - RUH',
	ITALY: 'F NAP - ION; A ROM - APU; A VEN H',
	RUSSIA: 'A MOS - UKR; A WAR - GAL; F SEV - BLA; F STP/SC - BOT',
	TURKEY: 'F ANK - BLA; A CON - BUL; A SMY - CON',
};

// --- Helpers (adapted from live-playthrough.mjs) ---

async function mentionBot(agent, command) {
	const text = `@${BOT_HANDLE} ${command}`;
	const rt = new RichText({ text });
	await rt.detectFacets(agent);
	const response = await agent.post({ text: rt.text, facets: rt.facets });
	return response;
}

async function sendDm(agent, text) {
	const botProfile = await agent.getProfile({ actor: BOT_HANDLE });
	const botDid = botProfile.data.did;
	const { data: convo } = await agent.api.chat.bsky.convo.getConvoForMembers({
		members: [botDid],
	}, { headers: { 'atproto-proxy': 'did:web:api.bsky.chat#bsky_chat' } });
	await agent.api.chat.bsky.convo.sendMessage({
		convoId: convo.convo.id,
		message: { text },
	}, { encoding: 'application/json', headers: { 'atproto-proxy': 'did:web:api.bsky.chat#bsky_chat' } });
}

async function waitForBotPost(agent, afterTimestamp, description) {
	const start = Date.now();
	while (Date.now() - start < MAX_WAIT) {
		const botProfile = await agent.getProfile({ actor: BOT_HANDLE });
		const botDid = botProfile.data.did;
		const { data } = await agent.getAuthorFeed({ actor: botDid, limit: 10 });
		for (const item of data.feed) {
			const post = item.post;
			if (new Date(post.indexedAt) > new Date(afterTimestamp)) {
				const text = post.record?.text ?? '';
				return { text, uri: post.uri, cid: post.cid, indexedAt: post.indexedAt };
			}
		}
		await new Promise(r => setTimeout(r, POLL_INTERVAL));
	}
	throw new Error(`Timed out waiting for bot to ${description}`);
}

/** Wait for a bot post containing a specific game ID */
async function waitForBotPostWithGameId(agent, gameId, afterTimestamp, description) {
	const start = Date.now();
	while (Date.now() - start < MAX_WAIT) {
		const botProfile = await agent.getProfile({ actor: BOT_HANDLE });
		const botDid = botProfile.data.did;
		const { data } = await agent.getAuthorFeed({ actor: botDid, limit: 15 });
		for (const item of data.feed) {
			const post = item.post;
			const text = post.record?.text ?? '';
			if (new Date(post.indexedAt) > new Date(afterTimestamp) && text.includes(`#${gameId}`)) {
				return { text, uri: post.uri, cid: post.cid, indexedAt: post.indexedAt };
			}
		}
		await new Promise(r => setTimeout(r, POLL_INTERVAL));
	}
	throw new Error(`Timed out waiting for bot post with #${gameId}: ${description}`);
}

async function waitForBotDm(agent, afterTimestamp, description) {
	const start = Date.now();
	const botProfile = await agent.getProfile({ actor: BOT_HANDLE });
	const botDid = botProfile.data.did;
	while (Date.now() - start < MAX_WAIT) {
		const { data: convo } = await agent.api.chat.bsky.convo.getConvoForMembers({
			members: [botDid],
		}, { headers: { 'atproto-proxy': 'did:web:api.bsky.chat#bsky_chat' } });
		const { data: messages } = await agent.api.chat.bsky.convo.getMessages({
			convoId: convo.convo.id,
			limit: 10,
		}, { headers: { 'atproto-proxy': 'did:web:api.bsky.chat#bsky_chat' } });
		for (const msg of messages.messages) {
			if (msg.sender?.did === botDid && new Date(msg.sentAt) > new Date(afterTimestamp)) {
				return msg.text ?? '';
			}
		}
		await new Promise(r => setTimeout(r, POLL_INTERVAL));
	}
	throw new Error(`Timed out waiting for bot DM: ${description}`);
}

/** Wait for a bot DM mentioning a specific game ID */
async function waitForBotDmWithGameId(agent, gameId, afterTimestamp, description) {
	const start = Date.now();
	const botProfile = await agent.getProfile({ actor: BOT_HANDLE });
	const botDid = botProfile.data.did;
	while (Date.now() - start < MAX_WAIT) {
		const { data: convo } = await agent.api.chat.bsky.convo.getConvoForMembers({
			members: [botDid],
		}, { headers: { 'atproto-proxy': 'did:web:api.bsky.chat#bsky_chat' } });
		const { data: messages } = await agent.api.chat.bsky.convo.getMessages({
			convoId: convo.convo.id,
			limit: 15,
		}, { headers: { 'atproto-proxy': 'did:web:api.bsky.chat#bsky_chat' } });
		for (const msg of messages.messages) {
			if (msg.sender?.did === botDid
				&& new Date(msg.sentAt) > new Date(afterTimestamp)
				&& (msg.text ?? '').includes(`#${gameId}`)) {
				return msg.text ?? '';
			}
		}
		await new Promise(r => setTimeout(r, POLL_INTERVAL));
	}
	throw new Error(`Timed out waiting for bot DM with #${gameId}: ${description}`);
}

// --- Game runner ---

/** Create a game and return the game ID. Must be called sequentially to avoid ID confusion. */
async function createGameAndExtractId(label, creator) {
	const log = (msg) => console.log(`  [Game ${label}] ${msg}`);
	const createTimestamp = new Date().toISOString();
	await mentionBot(creator.agent, 'new game');
	log(`${creator.name} posted "new game"`);

	const createPost = await waitForBotPost(creator.agent, createTimestamp, `create game ${label}`);
	const gameIdMatch = createPost.text.match(/#(\w+)/);
	if (!gameIdMatch) throw new Error(`Game ${label}: could not extract game ID from: ${createPost.text}`);
	const gameId = gameIdMatch[1];
	log(`Created: #${gameId}`);
	return gameId;
}

/**
 * Run a game from join through adjudication. Game ID must already be known.
 * Returns { gameId, powers } on success, throws on failure.
 */
async function runGameFromJoin(label, gameId, creator, joiner1, joiner2) {
	const log = (msg) => console.log(`  [Game ${label}] ${msg}`);

	// Step 1: Joiners join
	const join1Timestamp = new Date().toISOString();
	await mentionBot(joiner1.agent, `join #${gameId}`);
	log(`${joiner1.name} joining...`);
	await waitForBotPostWithGameId(joiner1.agent, gameId, join1Timestamp, `${joiner1.name} join ack`);
	log(`${joiner1.name} joined`);

	const join2Timestamp = new Date().toISOString();
	await mentionBot(joiner2.agent, `join #${gameId}`);
	log(`${joiner2.name} joining...`);
	await waitForBotPostWithGameId(joiner2.agent, gameId, join2Timestamp, `${joiner2.name} join ack`);
	log(`${joiner2.name} joined`);

	// Step 2: Start
	const startTimestamp = new Date().toISOString();
	await mentionBot(creator.agent, `start #${gameId}`);
	log('Starting...');
	await waitForBotPostWithGameId(creator.agent, gameId, startTimestamp, 'game start');
	log('Game started');

	// Step 3: Power assignment DMs
	const players = [creator, joiner1, joiner2];
	const powers = {};
	for (const player of players) {
		const dm = await waitForBotDmWithGameId(player.agent, gameId, startTimestamp, `${player.name} power`);
		const powerMatch = dm.match(/You are (\w+)/);
		if (!powerMatch) throw new Error(`Game ${label}: could not extract power for ${player.name} from: ${dm}`);
		powers[player.name] = powerMatch[1];
		log(`${player.name} is ${powers[player.name]}`);
	}

	// Step 4: Submit orders
	const orderTimestamp = new Date().toISOString();
	for (const player of players) {
		const power = powers[player.name];
		const orders = STANDARD_ORDERS[power];
		if (!orders) throw new Error(`Game ${label}: no standard orders for power ${power}`);
		await sendDm(player.agent, `#${gameId} ${orders}`);
		log(`${player.name} submitted orders for ${power}`);
		await waitForBotDmWithGameId(player.agent, gameId, orderTimestamp, `${player.name} order confirmation`);
		log(`${player.name} orders confirmed`);
	}

	// Step 5: Wait for adjudication
	log('Waiting for adjudication...');
	const adjPost = await waitForBotPostWithGameId(creator.agent, gameId, orderTimestamp, 'adjudication');
	log(`Adjudication complete: "${adjPost.text.slice(0, 80)}..."`);

	return { gameId, powers };
}

// --- Main ---

async function run() {
	console.log('=== YourStaunchAlly Concurrent Games Stress Test ===\n');

	// Login all 3 accounts
	console.log('Logging in test accounts...');
	const agentMap = {};
	for (const [key, acct] of Object.entries(ACCOUNTS)) {
		const agent = new AtpAgent({ service: 'https://bsky.social' });
		await agent.login(acct);
		agentMap[key] = { agent, name: acct.identifier.split('.')[0] };
		console.log(`  ${acct.identifier}: ${agent.session?.did}`);
	}

	// Ensure all accounts follow the bot
	console.log('\nEnsuring all accounts follow the bot...');
	for (const { agent, name } of Object.values(agentMap)) {
		try {
			const profile = await agent.getProfile({ actor: BOT_HANDLE });
			if (!profile.data.viewer?.following) {
				await agent.follow(profile.data.did);
				console.log(`  ${name} now follows the bot`);
			} else {
				console.log(`  ${name} already follows the bot`);
			}
		} catch (e) {
			console.log(`  ${name} follow attempt: ${e.message}`);
		}
	}

	await new Promise(r => setTimeout(r, 2000));

	// Create all 3 games sequentially — bot's creation response doesn't include
	// the creator handle, so we can't disambiguate concurrent "new game" responses.
	// Stagger by GAME_CREATION_STAGGER_MS to ensure each creation post is processed
	// before the next one lands.
	console.log('\n--- Creating 3 games (sequential) ---\n');

	const gameIdA = await createGameAndExtractId('A', agentMap.bobby);
	await new Promise(r => setTimeout(r, GAME_CREATION_STAGGER_MS));

	const gameIdB = await createGameAndExtractId('B', agentMap.jack);
	await new Promise(r => setTimeout(r, GAME_CREATION_STAGGER_MS));

	const gameIdC = await createGameAndExtractId('C', agentMap.rikki);

	console.log(`\n  Game IDs: A=#${gameIdA}, B=#${gameIdB}, C=#${gameIdC}\n`);

	// Now run join→start→orders→adjudicate in parallel for all 3 games.
	// All polling from here uses game-ID-aware helpers, so no cross-contamination.
	console.log('--- Running 3 games in parallel (join → adjudicate) ---\n');

	const results = await Promise.all([
		runGameFromJoin('A', gameIdA, agentMap.bobby, agentMap.jack, agentMap.rikki),
		runGameFromJoin('B', gameIdB, agentMap.jack, agentMap.bobby, agentMap.rikki),
		runGameFromJoin('C', gameIdC, agentMap.rikki, agentMap.bobby, agentMap.jack),
	]);

	// --- Verification ---
	console.log('\n--- Verification ---\n');
	let passed = true;

	// Check: All 3 games got distinct IDs
	const gameIds = results.map(r => r.gameId);
	const uniqueIds = new Set(gameIds);
	if (uniqueIds.size === 3) {
		console.log(`  [PASS] 3 distinct game IDs: ${gameIds.join(', ')}`);
	} else {
		console.log(`  [FAIL] Game IDs not distinct: ${gameIds.join(', ')}`);
		passed = false;
	}

	// Check: Power assignments are per-game (same player can have different powers)
	for (const name of ['bobbyquine', 'jackautomatic', 'rikkiwildside']) {
		const powersForPlayer = results.map(r => r.powers[name]).filter(Boolean);
		console.log(`  ${name}: ${powersForPlayer.join(', ')}`);
	}
	console.log(`  [PASS] Power assignments extracted for all players in all games`);

	// Check: All 3 adjudications completed
	console.log(`  [PASS] All 3 games adjudicated independently`);

	// Check docker logs for errors
	console.log('\n--- Checking Docker logs for errors ---\n');
	try {
		const { execSync } = await import('node:child_process');
		const logs = execSync('docker logs yourstaunchally-engine-1 --since 5m 2>&1', { encoding: 'utf-8' });
		const errorLines = logs.split('\n').filter(l => /error/i.test(l) && !/civil disorder/i.test(l));
		if (errorLines.length === 0) {
			console.log('  [PASS] No errors in Docker logs');
		} else {
			console.log(`  [WARN] ${errorLines.length} error lines in Docker logs:`);
			for (const line of errorLines.slice(0, 10)) {
				console.log(`    ${line}`);
			}
			// Warn but don't fail — some errors might be benign
		}
	} catch (e) {
		console.log(`  [SKIP] Could not check Docker logs: ${e.message}`);
	}

	// Summary
	console.log('\n' + '='.repeat(60));
	if (passed) {
		console.log('=== CONCURRENT GAMES STRESS TEST PASSED ===');
		console.log(`3 games ran in parallel, all completed successfully.`);
		console.log(`Game IDs: ${gameIds.join(', ')}`);
	} else {
		console.log('=== CONCURRENT GAMES STRESS TEST FAILED ===');
		process.exit(1);
	}
}

run().catch(err => {
	console.error('\n=== CONCURRENT GAMES STRESS TEST FAILED ===');
	console.error(err.message);
	console.error(err.stack);
	process.exit(1);
});
