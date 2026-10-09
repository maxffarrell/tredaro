import { type RequestHandler, error } from '@sveltejs/kit';
import { verifyServiceReportToken } from '#lib/server/services/jobs.ts';
import { readSharedJobPhoto } from '#lib/server/services/photos.ts';

/** Streams a customer-shared job photo to the signed service-report link holder. */
export const GET: RequestHandler = async ({ params }) => {
	const jobId = verifyServiceReportToken(params.token!);
	if (!jobId) error(404, 'Photo not found');
	const { row, bytes } = await readSharedJobPhoto(jobId, params.id!);
	return new Response(new Uint8Array(bytes), {
		headers: {
			'content-type': row.mime,
			'content-length': String(row.size),
			'cache-control': 'private, max-age=3600',
			'content-disposition': `inline; filename="${row.fileName.replace(/"/g, '')}"`
		}
	});
};
