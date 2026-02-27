import { AtpAgent } from '@atproto/api';
import Database from 'better-sqlite3';
import type { GameState } from '@yourstaunchally/shared';

async function main() {
	const agent = new AtpAgent({ service: 'https://bsky.social' });
	await agent.login({ identifier: process.env['BSKY_IDENTIFIER']!, password: process.env['BSKY_PASSWORD']! });
	const chatAgent = agent.withProxy('bsky_chat', 'did:web:api.bsky.chat') as AtpAgent;

	// Find Russia player
	const db = new Database(process.env['DB_PATH'] || './data/yourstaunchally.db', { readonly: true });
	const row = db.prepare("SELECT state_json FROM games WHERE game_id = 'uetpue'").get() as { state_json: string };
	const state = JSON.parse(row.state_json) as GameState;
	const russia = state.players.find(p => p.power === 'RUSSIA');
	if (!russia) { console.log('No Russia player'); return; }
	console.log('Russia:', russia.handle, russia.did);

	// Get convo with Russia
	const { data: convoData } = await chatAgent.chat.bsky.convo.getConvoForMembers({
		members: [russia.did],
	});

	// Get recent messages
	const { data: msgData } = await chatAgent.chat.bsky.convo.getMessages({
		convoId: convoData.convo.id,
		limit: 30,
	});

	const botDid = agent.session?.did;
	for (const msg of msgData.messages.reverse()) {
		const sender = (msg.sender as { did: string }).did;
		const who = sender === botDid ? 'BOT' : 'RUSSIA';
		const text = (msg as { text?: string }).text ?? '[no text]';
		console.log(`\n[${who}] ${text.substring(0, 300)}`);
	}
}
main().catch(console.error);
