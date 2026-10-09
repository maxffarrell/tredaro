import { type RequestHandler } from '@sveltejs/kit';
import { requireOrg } from '#lib/server/context.ts';
import { readJobDoc } from '#lib/server/services/photos.ts';

/** Streams a job document to an authenticated org member. */
export const GET: RequestHandler = async ({ params }) => {
	const ctx = await requireOrg();
	const { row, bytes } = await readJobDoc(ctx.orgId, params.id!);
	return new Response(new Uint8Array(bytes), {
		headers: {
			'content-type': row.mime,
			'content-length': String(row.size),
			'cache-control': 'private, max-age=3600',
			'content-disposition': `inline; filename="${row.fileName.replace(/"/g, '')}"`
		}
	});
};
