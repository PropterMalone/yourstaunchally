/**
 * Check login status for all bot accounts.
 * Reads accounts from scripts/accounts.json (gitignored).
 * Format: [{ "handle": "...", "password": "..." }, ...]
 */
import { AtpAgent } from '@atproto/api';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const configPath = resolve(dirname(fileURLToPath(import.meta.url)), 'accounts.json');

let accounts: { handle: string; password: string }[];
try {
	accounts = JSON.parse(readFileSync(configPath, 'utf8'));
} catch {
	console.error(`Missing ${configPath} — create it with: [{ "handle": "...", "password": "..." }]`);
	process.exit(1);
}

async function main() {
	for (const acct of accounts) {
		try {
			const agent = new AtpAgent({ service: 'https://bsky.social' });
			await agent.login({ identifier: acct.handle, password: acct.password });
			const labels =
				(await agent.getProfile({ actor: agent.session?.did as string })).data.labels ?? [];
			const spam = labels.find((l) => l.val === 'spam');
			console.log(`${acct.handle}: LOGIN OK${spam ? ' [SPAM]' : ' [clean]'}`);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			console.log(`${acct.handle}: LOGIN FAILED — ${msg}`);
		}
	}
}

main();
