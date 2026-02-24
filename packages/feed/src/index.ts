/**
 * YourStaunchAlly feed generator.
 *
 * Serves app.bsky.feed.getFeedSkeleton for per-game feeds.
 * Reads from the engine's SQLite database (game_posts table).
 *
 * Feed URIs follow the pattern:
 *   at://{publisher-did}/app.bsky.feed.generator/diplo-{gameId}
 */
import { createServer } from 'node:http';
import { createFeedHandler } from './handler.js';

const PORT = Number(process.env['FEED_PORT']) || 3001;
const DB_PATH = process.env['DB_PATH'] || '/data/yourstaunchally.db';
const PUBLISHER_DID = process.env['FEED_PUBLISHER_DID'] ?? 'did:web:diplo.example';

const handler = createFeedHandler(DB_PATH, PUBLISHER_DID);

const server = createServer(async (req, res) => {
	const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

	if (url.pathname === '/xrpc/app.bsky.feed.getFeedSkeleton') {
		try {
			const result = handler(url.searchParams);
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(result));
		} catch (err) {
			console.error('Feed error:', err);
			res.writeHead(500, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'InternalServerError', message: 'feed generation failed' }));
		}
		return;
	}

	if (url.pathname === '/xrpc/app.bsky.feed.describeFeedGenerator') {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(
			JSON.stringify({
				did: PUBLISHER_DID,
				feeds: handler.listFeeds(),
			}),
		);
		return;
	}

	if (url.pathname === '/.well-known/did.json') {
		const hostname = process.env['FEED_HOSTNAME'] ?? 'localhost';
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(
			JSON.stringify({
				'@context': ['https://www.w3.org/ns/did/v1'],
				id: `did:web:${hostname}`,
				service: [
					{
						id: '#bsky_fg',
						type: 'BskyFeedGenerator',
						serviceEndpoint: `https://${hostname}`,
					},
				],
			}),
		);
		return;
	}

	// Health check
	if (url.pathname === '/') {
		res.writeHead(200, { 'Content-Type': 'text/plain' });
		res.end('yourstaunchally feed generator');
		return;
	}

	res.writeHead(404);
	res.end('not found');
});

server.listen(PORT, () => {
	console.log(`YourStaunchAlly feed generator listening on port ${PORT}`);
	console.log(`DB: ${DB_PATH}`);
});
