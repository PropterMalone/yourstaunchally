/**
 * File a spam label appeal for the logged-in account.
 * Usage: BSKY_IDENTIFIER=handle BSKY_PASSWORD=pw npx tsx scripts/appeal-spam.ts
 */
import { AtpAgent } from '@atproto/api';

async function main() {
	const identifier = process.env['BSKY_IDENTIFIER'];
	const password = process.env['BSKY_PASSWORD'];
	if (!identifier || !password) throw new Error('set BSKY_IDENTIFIER and BSKY_PASSWORD');

	const agent = new AtpAgent({ service: 'https://bsky.social' });
	await agent.login({ identifier, password });

	const did = agent.session?.did as string;
	console.log(`Logged in as ${did}`);

	const profile = await agent.getProfile({ actor: did });
	console.log('Current labels:', JSON.stringify(profile.data.labels, null, 2));

	const result = await agent.createModerationReport({
		reasonType: 'com.atproto.moderation.defs#reasonAppeal',
		subject: { $type: 'com.atproto.admin.defs#repoRef', did },
		reason:
			'This is a Diplomacy board game bot. It was incorrectly flagged as spam after reposting a game thread (a reply chain of game-related content). The bot has rate limiting and only posts game-related content. I would appreciate the spam label being removed. Thank you.',
	});
	console.log('Appeal submitted:', JSON.stringify(result.data, null, 2));
}

main().catch((err) => {
	console.error('Failed:', err);
	process.exit(1);
});
