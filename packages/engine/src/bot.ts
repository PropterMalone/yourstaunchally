/**
 * Bluesky bot interactions — posting, DMs, mention polling.
 * Imperative shell: all ATProto I/O lives here.
 * Copied from Skeetwolf with label values updated.
 */
import { AtpAgent, RichText } from '@atproto/api';

const BLUESKY_MAX_GRAPHEMES = 300;

// Rate limiter: max 5 posts per 60s sliding window.
// Prevents burst posting that triggers Bluesky spam detection.
const POST_WINDOW_MS = 60_000;
const MAX_POSTS_PER_WINDOW = 5;
const postTimestamps: number[] = [];

async function rateLimitedPost<T>(fn: () => Promise<T>): Promise<T> {
	const now = Date.now();
	while (postTimestamps.length > 0 && (postTimestamps[0] ?? 0) < now - POST_WINDOW_MS) {
		postTimestamps.shift();
	}
	if (postTimestamps.length >= MAX_POSTS_PER_WINDOW) {
		const waitMs = (postTimestamps[0] ?? now) + POST_WINDOW_MS - now + 100;
		console.log(`Rate limit: waiting ${Math.round(waitMs / 1000)}s before posting`);
		await new Promise((r) => setTimeout(r, waitMs));
	}
	postTimestamps.push(Date.now());
	return fn();
}

/** Count graphemes using Intl.Segmenter (handles emoji/multi-byte correctly) */
export function graphemeLength(text: string): number {
	const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
	return [...segmenter.segment(text)].length;
}

/** Truncate text to Bluesky's 300-grapheme limit. Uses Intl.Segmenter for correct grapheme counting. */
export function truncateToLimit(text: string, limit = BLUESKY_MAX_GRAPHEMES): string {
	const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
	const segments = [...segmenter.segment(text)];
	if (segments.length <= limit) return text;
	return `${segments
		.slice(0, limit - 1)
		.map((s) => s.segment)
		.join('')}…`;
}

/**
 * Split long text into multiple ≤300-grapheme posts.
 * Splits at paragraph breaks (\n\n), then line breaks (\n), then spaces.
 * Adds [n/total] suffix to each chunk when splitting occurs.
 */
export function splitIntoPosts(text: string, limit = BLUESKY_MAX_GRAPHEMES): string[] {
	if (graphemeLength(text) <= limit) return [text];

	// Split into lines, preserving empty lines as paragraph markers
	const lines = text.split('\n');
	const chunks: string[] = [];
	let current = '';

	for (const line of lines) {
		const candidate = current ? `${current}\n${line}` : line;
		if (graphemeLength(candidate) <= limit) {
			current = candidate;
		} else if (!current) {
			// Single line exceeds limit — split on spaces
			const words = line.split(' ');
			let wordChunk = '';
			for (const word of words) {
				const wordCandidate = wordChunk ? `${wordChunk} ${word}` : word;
				if (graphemeLength(wordCandidate) <= limit) {
					wordChunk = wordCandidate;
				} else {
					if (wordChunk) chunks.push(wordChunk);
					wordChunk = word;
				}
			}
			current = wordChunk;
		} else {
			chunks.push(current);
			current = line;
		}
	}
	if (current) chunks.push(current);

	// Add [n/total] suffix if we split
	if (chunks.length > 1) {
		const total = chunks.length;
		return chunks.map((chunk, i) => {
			const suffix = ` [${i + 1}/${total}]`;
			// If adding suffix would exceed limit, trim the chunk
			if (graphemeLength(chunk + suffix) > limit) {
				return truncateToLimit(chunk, limit - graphemeLength(suffix)) + suffix;
			}
			return chunk + suffix;
		});
	}
	return chunks;
}

export interface BotConfig {
	identifier: string;
	password: string;
	service?: string;
}

export async function createAgent(config: BotConfig): Promise<AtpAgent> {
	const agent = new AtpAgent({
		service: config.service ?? 'https://bsky.social',
	});
	await agent.login({
		identifier: config.identifier,
		password: config.password,
	});
	return agent;
}

/** Detect @mention and link facets in text. Resolves handles → DIDs via the agent. */
async function buildFacets(
	agent: AtpAgent,
	text: string,
): Promise<{ text: string; facets: RichText['facets'] }> {
	const rt = new RichText({ text });
	await rt.detectFacets(agent);
	return { text: rt.text, facets: rt.facets };
}

export async function postMessage(
	agent: AtpAgent,
	text: string,
	labels?: string[],
): Promise<{ uri: string; cid: string }> {
	const truncated = truncateToLimit(text);
	const { facets } = await buildFacets(agent, truncated);
	const record: Record<string, unknown> = { text: truncated };
	if (facets?.length) record['facets'] = facets;
	if (labels?.length) {
		record['labels'] = {
			$type: 'com.atproto.label.defs#selfLabels',
			values: labels.map((val) => ({ val })),
		};
	}
	const response = await rateLimitedPost(() => agent.post(record));
	return { uri: response.uri, cid: response.cid };
}

export async function replyToPost(
	agent: AtpAgent,
	text: string,
	parentUri: string,
	parentCid: string,
	rootUri: string,
	rootCid: string,
	labels?: string[],
): Promise<{ uri: string; cid: string }> {
	const truncated = truncateToLimit(text);
	const { facets } = await buildFacets(agent, truncated);
	const record: Record<string, unknown> = {
		text: truncated,
		reply: {
			parent: { uri: parentUri, cid: parentCid },
			root: { uri: rootUri, cid: rootCid },
		},
	};
	if (facets?.length) record['facets'] = facets;
	if (labels?.length) {
		record['labels'] = {
			$type: 'com.atproto.label.defs#selfLabels',
			values: labels.map((val) => ({ val })),
		};
	}
	const response = await rateLimitedPost(() => agent.post(record));
	return { uri: response.uri, cid: response.cid };
}

/**
 * Post a (potentially long) message as a thread.
 * Splits text into multiple posts if it exceeds 300 graphemes.
 * Returns the first post's uri/cid (for threading/recording).
 */
export async function postThread(
	agent: AtpAgent,
	text: string,
	labels?: string[],
): Promise<{ uri: string; cid: string }> {
	const chunks = splitIntoPosts(text);
	const first = await postMessage(agent, chunks[0] as string, labels);
	let parent = first;
	for (let i = 1; i < chunks.length; i++) {
		parent = await replyToPost(
			agent,
			chunks[i] as string,
			parent.uri,
			parent.cid,
			first.uri,
			first.cid,
		);
	}
	return first;
}

/**
 * Reply with a (potentially long) message as a thread.
 * Splits text into multiple posts if it exceeds 300 graphemes.
 * Returns the first reply's uri/cid.
 */
export async function replyThread(
	agent: AtpAgent,
	text: string,
	parentUri: string,
	parentCid: string,
	rootUri: string,
	rootCid: string,
	labels?: string[],
): Promise<{ uri: string; cid: string }> {
	const chunks = splitIntoPosts(text);
	const first = await replyToPost(
		agent,
		chunks[0] as string,
		parentUri,
		parentCid,
		rootUri,
		rootCid,
		labels,
	);
	let parent = first;
	for (let i = 1; i < chunks.length; i++) {
		parent = await replyToPost(
			agent,
			chunks[i] as string,
			parent.uri,
			parent.cid,
			rootUri,
			rootCid,
		);
	}
	return first;
}

/**
 * Poll for new notifications (mentions).
 * Always starts from page 1 and paginates forward until hitting read
 * notifications or running out of pages. Does NOT use a persistent cursor —
 * Bluesky's listNotifications cursor is for pagination, not "since this point".
 * Relies on updateSeenNotifications + isRead to avoid reprocessing.
 */
export async function pollMentions(
	agent: AtpAgent,
): Promise<{ notifications: MentionNotification[] }> {
	const allMentions: MentionNotification[] = [];
	let pageCursor: string | undefined;
	const MAX_PAGES = 5;

	for (let page = 0; page < MAX_PAGES; page++) {
		const response = await agent.listNotifications({ cursor: pageCursor, limit: 50 });
		const notifs = response.data.notifications;
		if (notifs.length === 0) break;

		const mentions = notifs
			.filter((n) => (n.reason === 'mention' || n.reason === 'reply') && !n.isRead)
			.map((n) => ({
				uri: n.uri,
				cid: n.cid,
				authorDid: n.author.did,
				authorHandle: n.author.handle,
				text: (n.record as { text?: string }).text ?? '',
				indexedAt: n.indexedAt,
			}));

		allMentions.push(...mentions);

		// If any notification on this page was already read, we've caught up
		if (notifs.some((n) => n.isRead)) break;

		pageCursor = response.data.cursor;
		if (!pageCursor) break;
	}

	if (allMentions.length > 0) {
		await agent.updateSeenNotifications();
	}

	return { notifications: allMentions };
}

export interface MentionNotification {
	uri: string;
	cid: string;
	authorDid: string;
	authorHandle: string;
	text: string;
	indexedAt: string;
}

/** Extract the rkey (record key) from an AT URI: at://did/collection/rkey */
export function extractRkey(uri: string): string {
	const rkey = uri.split('/').pop();
	if (!rkey) throw new Error(`extractRkey: invalid AT URI "${uri}"`);
	return rkey;
}

/** Post with a quote-embed of another post */
export async function postWithQuote(
	agent: AtpAgent,
	text: string,
	quotedUri: string,
	quotedCid: string,
	labels?: string[],
): Promise<{ uri: string; cid: string }> {
	const truncated = truncateToLimit(text);
	const { facets } = await buildFacets(agent, truncated);
	const record: Record<string, unknown> = {
		text: truncated,
		embed: {
			$type: 'app.bsky.embed.record',
			record: { uri: quotedUri, cid: quotedCid },
		},
	};
	if (facets?.length) record['facets'] = facets;
	if (labels?.length) {
		record['labels'] = {
			$type: 'com.atproto.label.defs#selfLabels',
			values: labels.map((val) => ({ val })),
		};
	}
	const response = await rateLimitedPost(() => agent.post(record));
	return { uri: response.uri, cid: response.cid };
}

/** Resolve a Bluesky handle to a DID. Returns null if not found. */
export async function resolveHandle(agent: AtpAgent, handle: string): Promise<string | null> {
	try {
		const response = await agent.resolveHandle({ handle });
		return response.data.did;
	} catch {
		return null;
	}
}

// DM support in dm.ts — re-export for convenience
export type { DmSender, InboundDm } from './dm.js';
export {
	createBlueskyDmSender,
	createConsoleDmSender,
	createChatAgent,
	pollInboundDms,
} from './dm.js';
