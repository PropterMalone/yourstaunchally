/**
 * One-time script: DM all game #uetpue players about migration.
 * (Announcement already posted.)
 * Run: BSKY_IDENTIFIER=yrstaunchally.bsky.social BSKY_PASSWORD=r7ju-znlp-fdhu-ifz6 npx tsx scripts/migration-announce.ts
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

	// Use withProxy for chat API (same as dm.ts)
	const chatAgent = agent.withProxy('bsky_chat', 'did:web:api.bsky.chat') as AtpAgent;

	for (const player of PLAYERS) {
		const isAustria = player.power === 'AUSTRIA';

		let dmText: string;
		if (isAustria) {
			dmText = `Hey! YourStaunchAlly moved to a new account (@yrstaunchally.bsky.social). The old account got a spam label — same bot, fresh start.

Game #uetpue is still going. One thing: your earlier orders got corrupted because of a smart quote in your DM (the app sometimes auto-corrects quotes). I've cleared them so you can resubmit. Just DM this account with:

#uetpue A VIE - GAL; A BUD - SER; F TRI - ALB

(or whatever you'd like to order). Use straight quotes and semicolons between orders. You can also DM "#uetpue possible" to see all your legal moves.

Please follow this account and send future DMs here!`;
		} else {
			dmText = `Hey! YourStaunchAlly moved to a new account (@yrstaunchally.bsky.social). The old account got a spam label — same bot, fresh start.

Game #uetpue is still going. Your orders are intact. Please follow this account and send future DMs here. The old account will still forward your messages, but this is the new home.

DM "#uetpue orders" to review your submitted orders, or "#uetpue possible" to see legal moves.`;
		}

		try {
			const { data: convoData } = await chatAgent.chat.bsky.convo.getConvoForMembers({
				members: [player.did],
			});

			await chatAgent.chat.bsky.convo.sendMessage({
				convoId: convoData.convo.id,
				message: { text: dmText },
			});

			console.log(`DM sent to ${player.handle} (${player.power})${isAustria ? ' [with order fix notice]' : ''}`);
		} catch (err) {
			console.error(`Failed to DM ${player.handle}:`, err);
		}

		// Small delay between DMs to avoid rate limits
		await new Promise((r) => setTimeout(r, 500));
	}

	console.log('Done!');
}

main().catch((err) => {
	console.error('Fatal:', err);
	process.exit(1);
});
