/**
 * Map rendering pipeline: SVG (from Python diplomacy) → PNG (via sharp) → Bluesky blob.
 */
import type { AtpAgent } from '@atproto/api';
import sharp from 'sharp';
import { truncateToLimit } from './bot.js';

/** Convert SVG string to PNG buffer */
export async function svgToPng(svg: string): Promise<Buffer> {
	return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Post a message with an embedded map image from SVG.
 *  If `reply` is provided, posts as a reply instead of a top-level post. */
export async function postWithMapSvg(
	agent: AtpAgent,
	text: string,
	svg: string,
	altText: string,
	reply?: { parentUri: string; parentCid: string; rootUri: string; rootCid: string },
): Promise<{ uri: string; cid: string }> {
	const png = await svgToPng(svg);

	// Upload blob — response.data.blob is the BlobRef to use in image embed
	const uploadResponse = await agent.uploadBlob(png, { encoding: 'image/png' });
	const blobRef = uploadResponse.data.blob;

	const { RichText } = await import('@atproto/api');
	const truncated = truncateToLimit(text);
	const rt = new RichText({ text: truncated });
	await rt.detectFacets(agent);

	const record: Record<string, unknown> = {
		text: rt.text,
		facets: rt.facets,
		embed: {
			$type: 'app.bsky.embed.images',
			images: [
				{
					alt: altText,
					image: blobRef,
					aspectRatio: { width: 4, height: 3 },
				},
			],
		},
	};
	if (reply) {
		record['reply'] = {
			parent: { uri: reply.parentUri, cid: reply.parentCid },
			root: { uri: reply.rootUri, cid: reply.rootCid },
		};
	}

	const response = await agent.post(record);
	return { uri: response.uri, cid: response.cid };
}
