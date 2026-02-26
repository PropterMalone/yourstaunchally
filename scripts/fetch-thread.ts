/** Fetch game thread post content from old accounts */
import { AtpAgent } from '@atproto/api';

async function main() {
	const identifier = process.env['BSKY_IDENTIFIER'];
	const password = process.env['BSKY_PASSWORD'];
	if (!identifier || !password) throw new Error('set BSKY_IDENTIFIER and BSKY_PASSWORD');

	const agent = new AtpAgent({ service: 'https://bsky.social' });
	await agent.login({ identifier, password });

	const uris = [
		'at://did:plc:toqyodwleo2w7x2jnvbwdhle/app.bsky.feed.post/3mfmrskvsxp2i',
		'at://did:plc:toqyodwleo2w7x2jnvbwdhle/app.bsky.feed.post/3mfmtwcxzk72w',
		'at://did:plc:37xffvqtjezkwuvu5s74cvgk/app.bsky.feed.post/3mfna2j2lws2s',
		'at://did:plc:37xffvqtjezkwuvu5s74cvgk/app.bsky.feed.post/3mfndilgw372i',
	];

	for (const uri of uris) {
		try {
			const parts = uri.split('/');
			const repo = parts[2] as string;
			const rkey = parts[4] as string;
			const { data } = await agent.com.atproto.repo.getRecord({
				repo,
				collection: 'app.bsky.feed.post',
				rkey,
			});
			const val = data.value as Record<string, unknown>;
			console.log('---');
			console.log('URI:', uri);
			console.log('TEXT:', val.text);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			console.log('--- FAILED:', uri, msg);
		}
	}
}
main();
