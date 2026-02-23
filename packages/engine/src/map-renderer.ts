/**
 * Map rendering pipeline: SVG (from Python diplomacy) → PNG (via sharp) → Bluesky blob.
 */
import type { AtpAgent } from '@atproto/api';
import sharp from 'sharp';

/** Convert SVG string to PNG buffer */
export async function svgToPng(svg: string): Promise<Buffer> {
	return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Post a message with an embedded map image from SVG */
export async function postWithMapSvg(
	agent: AtpAgent,
	text: string,
	svg: string,
	altText: string,
): Promise<{ uri: string; cid: string }> {
	const png = await svgToPng(svg);

	// Upload blob — response.data.blob is the BlobRef to use in image embed
	const uploadResponse = await agent.uploadBlob(png, { encoding: 'image/png' });
	const blobRef = uploadResponse.data.blob;

	const { RichText } = await import('@atproto/api');
	const rt = new RichText({ text });
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

	const response = await agent.post(record);
	return { uri: response.uri, cid: response.cid };
}
