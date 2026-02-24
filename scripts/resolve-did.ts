import { AtpAgent } from '@atproto/api';

const handle = process.argv[2];
if (!handle) {
	console.error('Usage: npx tsx scripts/resolve-did.ts <handle>');
	process.exit(1);
}

async function main() {
	const agent = new AtpAgent({ service: 'https://bsky.social' });
	const res = await agent.resolveHandle({ handle });
	console.log(res.data.did);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
