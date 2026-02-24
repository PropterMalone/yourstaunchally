/**
 * One-time script: copy avatar and banner from old bot account to new one.
 * Downloads blobs from old account's PDS, uploads to new, updates profile.
 */
import { AtpAgent } from '@atproto/api';

const OLD_DID = 'did:plc:toqyodwleo2w7x2jnvbwdhle'; // yourstaunchally.bsky.social

async function main() {
	const identifier = process.env['BSKY_IDENTIFIER'];
	const password = process.env['BSKY_PASSWORD'];
	if (!identifier || !password) {
		console.error('Missing BSKY_IDENTIFIER or BSKY_PASSWORD');
		process.exit(1);
	}

	const agent = new AtpAgent({ service: 'https://bsky.social' });
	await agent.login({ identifier, password });
	console.log(`Logged in as ${agent.session?.handle}`);

	// Get old account's profile record for blob refs
	const oldProfile = await agent.com.atproto.repo.getRecord({
		repo: OLD_DID,
		collection: 'app.bsky.actor.profile',
		rkey: 'self',
	});
	const oldVal = oldProfile.data.value as Record<string, unknown>;
	console.log('Old avatar:', oldVal.avatar ? 'present' : 'missing');
	console.log('Old banner:', oldVal.banner ? 'present' : 'missing');

	// Download blobs from old PDS
	const oldPdsUrl = 'https://bsky.social';

	let newAvatarRef: unknown = undefined;
	if (oldVal.avatar) {
		const avatarBlob = oldVal.avatar as { ref: { $link: string }; mimeType: string };
		const cid = avatarBlob.ref.$link ?? (avatarBlob.ref as unknown as string);
		console.log(`Downloading avatar blob ${cid}...`);
		const res = await fetch(
			`${oldPdsUrl}/xrpc/com.atproto.sync.getBlob?did=${OLD_DID}&cid=${cid}`,
		);
		if (!res.ok) throw new Error(`Failed to download avatar: ${res.status}`);
		const data = Buffer.from(await res.arrayBuffer());
		console.log(`Avatar: ${data.length} bytes, uploading...`);
		const upload = await agent.uploadBlob(data, { encoding: avatarBlob.mimeType });
		newAvatarRef = upload.data.blob;
		console.log('Avatar uploaded');
	}

	let newBannerRef: unknown = undefined;
	if (oldVal.banner) {
		const bannerBlob = oldVal.banner as { ref: { $link: string }; mimeType: string };
		const cid = bannerBlob.ref.$link ?? (bannerBlob.ref as unknown as string);
		console.log(`Downloading banner blob ${cid}...`);
		const res = await fetch(
			`${oldPdsUrl}/xrpc/com.atproto.sync.getBlob?did=${OLD_DID}&cid=${cid}`,
		);
		if (!res.ok) throw new Error(`Failed to download banner: ${res.status}`);
		const data = Buffer.from(await res.arrayBuffer());
		console.log(`Banner: ${data.length} bytes, uploading...`);
		const upload = await agent.uploadBlob(data, { encoding: bannerBlob.mimeType });
		newBannerRef = upload.data.blob;
		console.log('Banner uploaded');
	}

	// Update new account's profile, preserving existing fields
	const newProfile = await agent.com.atproto.repo.getRecord({
		repo: agent.session?.did ?? '',
		collection: 'app.bsky.actor.profile',
		rkey: 'self',
	});
	const existing = newProfile.data.value as Record<string, unknown>;

	await agent.com.atproto.repo.putRecord({
		repo: agent.session?.did ?? '',
		collection: 'app.bsky.actor.profile',
		rkey: 'self',
		record: {
			...existing,
			...(newAvatarRef ? { avatar: newAvatarRef } : {}),
			...(newBannerRef ? { banner: newBannerRef } : {}),
		},
	});

	console.log('Profile updated with avatar and banner!');
}

main().catch((err) => {
	console.error('Fatal:', err);
	process.exit(1);
});
