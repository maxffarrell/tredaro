import { type RequestHandler } from '@sveltejs/kit';
import { requireUser } from '#lib/server/context.ts';
import { readPortalCustomerDoc } from '#lib/server/services/photos.ts';

/** Streams a customer document shared with the signed-in portal customer. */
export const GET: RequestHandler = async ({ params }) => {
	const { user } = requireUser();
	const { row, bytes } = await readPortalCustomerDoc(user.id, params.id!);
	return new Response(new Uint8Array(bytes), {
		headers: {
			'content-type': row.mime,
			'content-length': String(row.size),
			'cache-control': 'private, max-age=3600',
			'content-disposition': `inline; filename="${row.fileName.replace(/"/g, '')}"`
		}
	});
};
