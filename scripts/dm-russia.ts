/** One-time: DM Russia about fixed orders */
import { AtpAgent } from '@atproto/api';

const RUSSIA_DID = 'did:plc:y2ypsghs76fzgghdujk5olu3';

async function main() {
	const identifier = process.env['BSKY_IDENTIFIER'];
	const password = process.env['BSKY_PASSWORD'];
	if (!identifier || !password) throw new Error('set BSKY_IDENTIFIER and BSKY_PASSWORD');

	const agent = new AtpAgent({ service: 'https://bsky.social' });
	await agent.login({ identifier, password });
	const chatAgent = agent.withProxy('bsky_chat', 'did:web:api.bsky.chat') as AtpAgent;

	const { data: convoData } = await chatAgent.chat.bsky.convo.getConvoForMembers({
		members: [RUSSIA_DID],
	});

	await chatAgent.chat.bsky.convo.sendMessage({
		convoId: convoData.convo.id,
		message: {
			text: `Hey! Fixed two bugs on our end — sorry about the trouble.

1. There was a stale order stuck in your order set from an earlier submission that couldn't be overwritten. Cleared it out.
2. Support-hold with "H" at the end (like "A UKR S F RUM H") now works — we were only accepting "A UKR S F RUM" before.

Your current orders for #uetpue:
  A WAR H
  F RUM H
  A UKR S F RUM
  F BOT - SWE

All 4 are valid. DM "#uetpue orders" anytime to confirm, or send new orders to update.`,
		},
	});

	console.log('DM sent to Russia');
}
main();
