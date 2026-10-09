import { type RequestHandler } from '@sveltejs/kit';
import { requireOrg } from '#lib/server/context.ts';
import { readEquipmentPhoto } from '#lib/server/services/photos.ts';

/** Streams an equipment photo to an authenticated org member. */
export const GET: RequestHandler = async ({ params }) => {
	const ctx = await requireOrg();
	const { row, bytes } = await readEquipmentPhoto(ctx.orgId, params.id!);
	return new Response(new Uint8Array(bytes), {
		headers: {
			'content-type': row.photoMime || 'image/jpeg',
			'content-length': String(bytes.length),
			'cache-control': 'private, max-age=3600',
			'content-disposition': `inline; filename="${(row.name || 'equipment').replace(/"/g, '')}"`
		}
	});
};
