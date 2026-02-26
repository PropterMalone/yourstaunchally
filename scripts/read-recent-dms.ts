/** Check recent DMs across all conversations */
import { AtpAgent } from '@atproto/api';

async function main() {
	const identifier = process.env['BSKY_IDENTIFIER'];
	const password = process.env['BSKY_PASSWORD'];
	if (!identifier || !password) throw new Error('set BSKY_IDENTIFIER and BSKY_PASSWORD');

	const agent = new AtpAgent({ service: 'https://bsky.social' });
	await agent.login({ identifier, password });
	const chatAgent = agent.withProxy('bsky_chat', 'did:web:api.bsky.chat') as AtpAgent;

	const { data } = await chatAgent.chat.bsky.convo.listConvos({ limit: 10 });

	const botDid = agent.session?.did as string;
	for (const convo of data.convos) {
		const other = convo.members.find((m) => m.did !== botDid);
		if (!other) continue;

		const { data: msgs } = await chatAgent.chat.bsky.convo.getMessages({
			convoId: convo.id,
			limit: 3,
		});

		const recent = msgs.messages.reverse();
		const hasRecent = recent.some((m) => {
			if (m.$type !== 'chat.bsky.convo.defs#messageView') return false;
			const age = Date.now() - new Date(m.sentAt).getTime();
			return age < 2 * 60 * 60 * 1000; // last 2 hours
		});

		if (!hasRecent) continue;

		console.log(`=== ${other.handle} ===`);
		for (const msg of recent) {
			if (msg.$type === 'chat.bsky.convo.defs#messageView') {
				const sender = msg.sender.did === botDid ? 'BOT' : 'USER';
				const time = new Date(msg.sentAt).toISOString().slice(11, 19);
				console.log(`[${time}] ${sender}: ${msg.text?.slice(0, 120)}`);
			}
		}
		console.log('');
	}
}
main();
