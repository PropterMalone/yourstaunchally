/**
 * Check spam labels on all bot accounts.
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
			const did = agent.session?.did as string;
			const profile = await agent.getProfile({ actor: did });
			const labels = profile.data.labels ?? [];
			const spamLabel = labels.find((l) => l.val === 'spam');
			if (spamLabel) {
				console.log(`${acct.handle}: SPAM (since ${spamLabel.cts})`);
			} else if (labels.length > 0) {
				console.log(`${acct.handle}: labeled [${labels.map((l) => l.val).join(', ')}]`);
			} else {
				console.log(`${acct.handle}: clean`);
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			// Try public API as fallback (account may be locked/deleted)
			try {
				const pub = new AtpAgent({ service: 'https://public.api.bsky.app' });
				const profile = await pub.getProfile({ actor: acct.handle });
				const labels = profile.data.labels ?? [];
				const spamLabel = labels.find((l) => l.val === 'spam');
				if (spamLabel) {
					console.log(
						`${acct.handle}: SPAM (since ${spamLabel.cts}) [login failed: ${msg}]`,
					);
				} else {
					console.log(`${acct.handle}: login failed (${msg}), public profile clean`);
				}
			} catch {
				console.log(`${acct.handle}: login failed (${msg}), profile not found`);
			}
		}
	}
}

main();
