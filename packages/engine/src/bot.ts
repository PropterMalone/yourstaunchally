/**
 * Bluesky bot interactions — re-exports from propter-bsky-kit.
 * pattern: Imperative Shell
 */

export { createAgent, buildFacets, resolveHandle, extractRkey } from 'propter-bsky-kit';
export { graphemeLength, truncateToLimit } from 'propter-bsky-kit';
export { splitForPost } from 'propter-bsky-kit';

export {
	postMessage,
	postMessageChain,
	replyToPost,
	replyToPostChain,
	postWithQuote,
	postWithQuoteChain,
} from 'propter-bsky-kit';
export type { PostingOptions } from 'propter-bsky-kit';

export { pollMentions, pollAllMentions } from 'propter-bsky-kit';

export {
	createChatAgent,
	createBlueskyDmSender,
	createConsoleDmSender,
	pollInboundDms,
} from 'propter-bsky-kit';

export { createLabelerClient } from 'propter-bsky-kit';

export type {
	BotConfig,
	PostRef,
	DmResult,
	DmSender,
	MentionNotification,
	InboundDm,
	LabelerClient,
} from 'propter-bsky-kit';
