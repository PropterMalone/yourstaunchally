#!/usr/bin/env node
/**
 * Smoke test: sends a mention to the bot from a test account.
 * Usage: node scripts/smoke-test.mjs [command]
 * Default command: "new game"
 */
import { AtpAgent, RichText } from '@atproto/api';

const BOT_HANDLE = 'yourstaunchally.bsky.social';
const TEST_IDENTIFIER = process.env.TEST_BSKY_IDENTIFIER ?? 'bobbyquine.bsky.social';
const TEST_PASSWORD = process.env.TEST_BSKY_PASSWORD;
if (!TEST_PASSWORD) {
	console.error('set TEST_BSKY_PASSWORD (and optionally TEST_BSKY_IDENTIFIER)');
	process.exit(1);
}

const command = process.argv[2] ?? 'new game';
const text = `@${BOT_HANDLE} ${command}`;

console.log(`Logging in as ${TEST_IDENTIFIER}...`);
const agent = new AtpAgent({ service: 'https://bsky.social' });
await agent.login({ identifier: TEST_IDENTIFIER, password: TEST_PASSWORD });
console.log(`Logged in as ${agent.session?.did}`);

// Build rich text with proper mention facet
const rt = new RichText({ text });
await rt.detectFacets(agent);
console.log(`Facets:`, JSON.stringify(rt.facets, null, 2));

const response = await agent.post({
	text: rt.text,
	facets: rt.facets,
});

console.log(`Posted: ${response.uri}`);
console.log(`Text: "${text}"`);
console.log('Done. Watch bot logs: docker compose logs -f');
