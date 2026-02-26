/** Read recent DMs with a specific user */
import { AtpAgent } from '@atproto/api';

const TARGET_DID = process.argv[2] || 'did:plc:y2ypsghs76fzgghdujk5olu3'; // wtdore (Russia)

async function main() {
	const identifier = process.env['BSKY_IDENTIFIER'];
	const password = process.env['BSKY_PASSWORD'];
	if (!identifier || !password) throw new Error('set BSKY_IDENTIFIER and BSKY_PASSWORD');

	const agent = new AtpAgent({ service: 'https://bsky.social' });
	await agent.login({ identifier, password });
	const chatAgent = agent.withProxy('bsky_chat', 'did:web:api.bsky.chat') as AtpAgent;

	const { data: convoData } = await chatAgent.chat.bsky.convo.getConvoForMembers({
		members: [TARGET_DID],
	});

	const { data: messages } = await chatAgent.chat.bsky.convo.getMessages({
		convoId: convoData.convo.id,
		limit: 20,
	});

	const botDid = agent.session?.did as string;
	for (const msg of messages.messages.reverse()) {
		if (msg.$type === 'chat.bsky.convo.defs#messageView') {
			const sender = msg.sender.did === botDid ? 'BOT' : 'USER';
			const time = new Date(msg.sentAt).toISOString().slice(11, 19);
			console.log(`[${time}] ${sender}: ${msg.text}`);
			console.log('---');
		}
	}
}
main();
