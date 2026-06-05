/** Quick check of bot's current Bluesky profile */
import { createAgent } from '../packages/engine/src/bot.js';

async function main() {
	const agent = await createAgent({
		identifier: process.env['BSKY_IDENTIFIER']!,
		password: process.env['BSKY_PASSWORD']!,
	});
	const profile = await agent.getProfile({ actor: agent.session!.did });
	console.log('Display name:', profile.data.displayName ?? '(none)');
	console.log('Description:', profile.data.description ?? '(none)');
}

main().catch(console.error);
