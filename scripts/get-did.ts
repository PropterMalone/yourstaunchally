import { AtpAgent } from '@atproto/api';

async function main() {
	const identifier = process.env['BSKY_IDENTIFIER'];
	const password = process.env['BSKY_PASSWORD'];
	if (!identifier || !password) throw new Error('set BSKY_IDENTIFIER and BSKY_PASSWORD');

	const agent = new AtpAgent({ service: 'https://bsky.social' });
	await agent.login({ identifier, password });
	console.log('DID:', agent.session?.did);
	console.log('Handle:', agent.session?.handle);
}

main().catch(console.error);
