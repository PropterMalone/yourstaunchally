/**
 * One-time script: DM all game #uetpue players about migration to yourstalwartally.
 * Run from old account:
 * BSKY_IDENTIFIER=<handle> BSKY_PASSWORD=<pw> npx tsx scripts/migration-announce.ts
 */
import { AtpAgent } from '@atproto/api';

const PLAYERS = [
	{ did: 'did:plc:pnx2fjuannbdpy3337ggthpp', handle: 'peark.es', power: 'FRANCE' },
	{ did: 'did:plc:upp6ezdsjityf5md7ezazsiw', handle: 'themlg.bsky.social', power: 'TURKEY' },
	{ did: 'did:plc:d6dbpryvpfljih7la67t3gqd', handle: 'schroedinger.bsky.social', power: 'ENGLAND' },
	{ did: 'did:plc:6wngtt3rtz5in67bczxzomda', handle: 'tonylover.bsky.social', power: 'GERMANY' },
	{ did: 'did:plc:wi5lzx23vpdnzg2wr4c6l7fk', handle: 'nestor-makflow.bsky.social', power: 'ITALY' },
	{ did: 'did:plc:y2ypsghs76fzgghdujk5olu3', handle: 'wtdore.bsky.social', power: 'RUSSIA' },
	{ did: 'did:plc:h23gfou5fdwgjbtg2y4xbtpv', handle: 'kingchirp.bsky.social', power: 'AUSTRIA' },
];

const DM_TEXT = `Hey! YourStaunchAlly moved again — new account is @yourstalwartally.bsky.social. Same bot, same game, new handle (the old one got spam-labeled).

Game #uetpue is still going. Your orders are intact. Please follow the new account and send future DMs there. The old accounts will still forward your messages, but the new one is home now.

DM "#uetpue orders" to the new account to review your submitted orders, or "#uetpue possible" to see legal moves.`;

async function main() {
	const identifier = process.env['BSKY_IDENTIFIER'];
	const password = process.env['BSKY_PASSWORD'];
	if (!identifier || !password) {
		console.error('Missing BSKY_IDENTIFIER or BSKY_PASSWORD');
		process.exit(1);
	}

	const agent = new AtpAgent({ service: 'https://bsky.social' });
	await agent.login({ identifier, password });
	console.log(`Logged in as ${agent.session?.handle} (${agent.session?.did})`);

	const chatAgent = agent.withProxy('bsky_chat', 'did:web:api.bsky.chat') as AtpAgent;

	for (const player of PLAYERS) {
		try {
			const { data: convoData } = await chatAgent.chat.bsky.convo.getConvoForMembers({
				members: [player.did],
			});

			await chatAgent.chat.bsky.convo.sendMessage({
				convoId: convoData.convo.id,
				message: { text: DM_TEXT },
			});

			console.log(`DM sent to ${player.handle} (${player.power})`);
		} catch (err) {
			console.error(`Failed to DM ${player.handle}:`, err);
		}

		// 2s delay between DMs to avoid rate limits
		await new Promise((r) => setTimeout(r, 2000));
	}

	console.log('Done!');
}

main().catch((err) => {
	console.error('Fatal:', err);
	process.exit(1);
});
