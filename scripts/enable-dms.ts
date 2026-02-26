/** Enable DMs from everyone on the bot account */
import { AtpAgent } from '@atproto/api';

async function main() {
	const identifier = process.env['BSKY_IDENTIFIER'];
	const password = process.env['BSKY_PASSWORD'];
	if (!identifier || !password) throw new Error('set BSKY_IDENTIFIER and BSKY_PASSWORD');

	const agent = new AtpAgent({ service: 'https://bsky.social' });
	await agent.login({ identifier, password });

	await agent.com.atproto.repo.putRecord({
		repo: agent.session?.did as string,
		collection: 'chat.bsky.actor.declaration',
		rkey: 'self',
		record: {
			$type: 'chat.bsky.actor.declaration',
			allowIncoming: 'all',
		},
	});

	console.log('DMs enabled for all users');

	// Verify
	const { data } = await agent.com.atproto.repo.getRecord({
		repo: agent.session?.did as string,
		collection: 'chat.bsky.actor.declaration',
		rkey: 'self',
	});
	console.log('Verified:', JSON.stringify(data.value));
}
main();
