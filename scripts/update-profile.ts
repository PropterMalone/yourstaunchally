/** Update the bot's Bluesky profile bio */
import { createAgent } from '../packages/engine/src/bot.js';

async function main() {
	const agent = await createAgent({
		identifier: process.env['BSKY_IDENTIFIER']!,
		password: process.env['BSKY_PASSWORD']!,
	});

	const current = await agent.getProfile({ actor: agent.session!.did });
	const existingAvatar = current.data.avatar;
	const existingBanner = current.data.banner;

	// Get existing profile record to preserve avatar/banner blob refs
	const { data: existingRecord } = await agent.com.atproto.repo.getRecord({
		repo: agent.session!.did,
		collection: 'app.bsky.actor.profile',
		rkey: 'self',
	});
	const existing = existingRecord.value as Record<string, unknown>;

	await agent.com.atproto.repo.putRecord({
		repo: agent.session!.did,
		collection: 'app.bsky.actor.profile',
		rkey: 'self',
		record: {
			...existing,
			displayName: 'YourStalwartAlly',
			description: `Diplomacy bot for Bluesky. 7 powers, 1 map, 0 trust.

Mention me with "new game" to start. Orders via DM.

FAQ: malone.taildf301e.ts.net/ysa/faq
Source: github.com/PropterMalone/yourstaunchally
Run by @proptermalone.bsky.social`,
		},
	});

	console.log('Profile updated!');
}

main().catch(console.error);
