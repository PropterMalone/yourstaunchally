#!/usr/bin/env node
/**
 * Live Bluesky playthrough test — tests the full game cycle through the deployed bot.
 * Uses bobbyquine and starcountr test accounts.
 *
 * Usage: node scripts/live-playthrough.mjs
 */
import { AtpAgent, RichText } from '@atproto/api';

const BOT_HANDLE = 'yourstaunchally.bsky.social';
const POLL_INTERVAL = 5000; // 5s between checks
const MAX_WAIT = 120_000; // 2 min max wait

const ACCOUNTS = [
	{ identifier: 'bobbyquine.bsky.social', password: '24f5-rs2m-3xjo-p4gq' },
	{ identifier: 'jackautomatic.bsky.social', password: 'vbh_gdw*qtc6RTE0jdg' },
];

/** Post a mention to the bot with proper facets */
async function mentionBot(agent, command) {
	const text = `@${BOT_HANDLE} ${command}`;
	const rt = new RichText({ text });
	await rt.detectFacets(agent);
	const response = await agent.post({ text: rt.text, facets: rt.facets });
	console.log(`  Posted: "${text}" → ${response.uri}`);
	return response;
}

/** Send a DM to the bot */
async function sendDm(agent, text) {
	// Get bot DID
	const botProfile = await agent.getProfile({ actor: BOT_HANDLE });
	const botDid = botProfile.data.did;

	// Create/get conversation
	const { data: convo } = await agent.api.chat.bsky.convo.getConvoForMembers({
		members: [botDid],
	}, { headers: { 'atproto-proxy': 'did:web:api.bsky.chat#bsky_chat' } });

	// Send message
	const { data: msg } = await agent.api.chat.bsky.convo.sendMessage({
		convoId: convo.convo.id,
		message: { text },
	}, { encoding: 'application/json', headers: { 'atproto-proxy': 'did:web:api.bsky.chat#bsky_chat' } });

	console.log(`  DM sent: "${text.slice(0, 80)}${text.length > 80 ? '...' : ''}"`);
	return msg;
}

/** Wait for the bot to post something new */
async function waitForBotPost(agent, afterTimestamp, description) {
	console.log(`  Waiting for bot to ${description}...`);
	const start = Date.now();

	while (Date.now() - start < MAX_WAIT) {
		const botProfile = await agent.getProfile({ actor: BOT_HANDLE });
		const botDid = botProfile.data.did;
		const { data } = await agent.getAuthorFeed({ actor: botDid, limit: 5 });

		for (const item of data.feed) {
			const post = item.post;
			if (new Date(post.indexedAt) > new Date(afterTimestamp)) {
				const text = post.record?.text ?? '';
				console.log(`  Bot posted: "${text.slice(0, 100)}${text.length > 100 ? '...' : ''}"`);
				return { text, uri: post.uri, cid: post.cid, indexedAt: post.indexedAt };
			}
		}

		await new Promise(r => setTimeout(r, POLL_INTERVAL));
	}

	throw new Error(`Timed out waiting for bot to ${description}`);
}

/** Wait for a DM response from the bot */
async function waitForBotDm(agent, afterTimestamp, description) {
	console.log(`  Waiting for bot DM: ${description}...`);
	const start = Date.now();
	const botProfile = await agent.getProfile({ actor: BOT_HANDLE });
	const botDid = botProfile.data.did;

	while (Date.now() - start < MAX_WAIT) {
		const { data: convo } = await agent.api.chat.bsky.convo.getConvoForMembers({
			members: [botDid],
		}, { headers: { 'atproto-proxy': 'did:web:api.bsky.chat#bsky_chat' } });

		const { data: messages } = await agent.api.chat.bsky.convo.getMessages({
			convoId: convo.convo.id,
			limit: 5,
		}, { headers: { 'atproto-proxy': 'did:web:api.bsky.chat#bsky_chat' } });

		for (const msg of messages.messages) {
			if (msg.sender?.did === botDid && new Date(msg.sentAt) > new Date(afterTimestamp)) {
				const text = msg.text ?? '';
				console.log(`  Bot DM'd: "${text.slice(0, 100)}${text.length > 100 ? '...' : ''}"`);
				return text;
			}
		}

		await new Promise(r => setTimeout(r, POLL_INTERVAL));
	}

	throw new Error(`Timed out waiting for bot DM: ${description}`);
}

async function run() {
	console.log('=== YourStaunchAlly Live Bluesky Playthrough ===\n');

	// Login both test accounts
	const agents = [];
	for (const acct of ACCOUNTS) {
		console.log(`Logging in as ${acct.identifier}...`);
		const agent = new AtpAgent({ service: 'https://bsky.social' });
		await agent.login(acct);
		agents.push(agent);
		console.log(`  OK: ${agent.session?.did}`);
	}

	const [bobby, star] = agents;

	// Ensure test accounts follow the bot (needed for DMs)
	console.log('\nEnsuring test accounts follow the bot...');
	for (const agent of agents) {
		try {
			const profile = await agent.getProfile({ actor: BOT_HANDLE });
			if (!profile.data.viewer?.following) {
				await agent.follow(profile.data.did);
				console.log(`  ${agent.session?.handle} now follows the bot`);
			} else {
				console.log(`  ${agent.session?.handle} already follows the bot`);
			}
		} catch (e) {
			console.log(`  Follow attempt: ${e.message}`);
		}
	}

	// Small delay for follow to propagate
	await new Promise(r => setTimeout(r, 2000));

	const timestamp = new Date().toISOString();

	// Step 1: Create a new game
	console.log('\n--- Step 1: Create game ---');
	await mentionBot(bobby, 'new game');
	const createPost = await waitForBotPost(bobby, timestamp, 'create game announcement');

	// Extract game ID from the bot's response
	const gameIdMatch = createPost.text.match(/#(\w+)/);
	if (!gameIdMatch) throw new Error('Could not extract game ID from bot response');
	const gameId = gameIdMatch[1];
	console.log(`  Game ID: #${gameId}`);

	// Step 2: Second player joins
	console.log('\n--- Step 2: starcountr joins ---');
	const joinTimestamp = new Date().toISOString();
	await mentionBot(star, `join #${gameId}`);
	await waitForBotPost(star, joinTimestamp, 'acknowledge join');

	// Step 3: Start the game
	console.log('\n--- Step 3: Start game ---');
	const startTimestamp = new Date().toISOString();
	await mentionBot(bobby, `start #${gameId}`);

	// Wait for the game start announcement
	const startPost = await waitForBotPost(bobby, startTimestamp, 'post game start');
	console.log(`  Game started!`);

	// Wait for DMs with power assignments
	console.log('\n--- Step 4: Check power assignment DMs ---');
	const bobbyPowerDm = await waitForBotDm(bobby, startTimestamp, 'bobbyquine power assignment');
	const starPowerDm = await waitForBotDm(star, startTimestamp, 'starcountr power assignment');

	// Extract powers from DMs
	const bobbyPower = bobbyPowerDm.match(/You are (\w+)/)?.[1];
	const starPower = starPowerDm.match(/You are (\w+)/)?.[1];
	console.log(`  bobbyquine is: ${bobbyPower}`);
	console.log(`  starcountr is: ${starPower}`);

	if (!bobbyPower || !starPower) throw new Error('Could not extract powers from DMs');

	// Step 5: Submit orders via DM
	// Use standard openings based on which power each player got
	const STANDARD_ORDERS = {
		AUSTRIA: 'A BUD - SER; A VIE - BUD; F TRI - ALB',
		ENGLAND: 'F LON - NTH; A LVP - YOR; F EDI - NWG',
		FRANCE: 'A PAR - BUR; A MAR - SPA; F BRE - MAO',
		GERMANY: 'F KIE - DEN; A BER - KIE; A MUN - RUH',
		ITALY: 'F NAP - ION; A ROM - APU; A VEN H',
		RUSSIA: 'A MOS - UKR; A WAR - GAL; F SEV - BLA; F STP/SC - BOT',
		TURKEY: 'F ANK - BLA; A CON - BUL; A SMY - CON',
	};

	console.log('\n--- Step 5: Submit orders ---');
	const orderTimestamp = new Date().toISOString();

	const bobbyOrders = STANDARD_ORDERS[bobbyPower];
	const starOrders = STANDARD_ORDERS[starPower];

	await sendDm(bobby, `#${gameId} ${bobbyOrders}`);
	await waitForBotDm(bobby, orderTimestamp, 'order confirmation');

	const starOrderTimestamp = new Date().toISOString();
	await sendDm(star, `#${gameId} ${starOrders}`);
	await waitForBotDm(star, starOrderTimestamp, 'order confirmation');

	// With only 2 players submitting (other 5 in civil disorder), the bot should
	// process immediately since allOrdersSubmitted checks only assigned powers
	console.log('\n--- Step 6: Wait for adjudication ---');
	const adjPost = await waitForBotPost(bobby, orderTimestamp, 'post adjudication results');

	console.log('\n=== LIVE PLAYTHROUGH TEST PASSED ===');
	console.log(`Game #${gameId}: Created → Joined → Started → Orders → Adjudicated`);
	console.log('Full cycle works on live Bluesky!');
}

run().catch(err => {
	console.error('\n=== LIVE PLAYTHROUGH FAILED ===');
	console.error(err.message);
	process.exit(1);
});
