import { AtpAgent } from '@atproto/api';

async function main() {
	const identifier = process.env['BSKY_IDENTIFIER'];
	const password = process.env['BSKY_PASSWORD'];
	if (!identifier || !password) throw new Error('set BSKY_IDENTIFIER and BSKY_PASSWORD');

	const agent = new AtpAgent({ service: 'https://bsky.social' });
	await agent.login({ identifier, password });

	// Check chat declaration
	try {
		const { data } = await agent.com.atproto.repo.getRecord({
			repo: agent.session?.did as string,
			collection: 'chat.bsky.actor.declaration',
			rkey: 'self',
		});
		console.log('Chat declaration:', JSON.stringify(data.value));
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		console.log('No chat declaration found:', msg);
	}
}
main();
