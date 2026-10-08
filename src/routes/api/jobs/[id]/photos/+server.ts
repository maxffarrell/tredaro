import { json, type RequestHandler } from '@sveltejs/kit';
import { requireOrg } from '#lib/server/context.ts';
import { saveJobPhoto } from '#lib/server/services/photos.ts';

/** Upload a photo to a job: `POST /api/jobs/<jobId>/photos` (multipart `file` field). */
export const POST: RequestHandler = async ({ params, request }) => {
	const ctx = await requireOrg();
	const form = await request.formData();
	const file = form.get('file');
	if (!(file instanceof File) || file.size === 0) {
		return json({ message: 'Attach a file to upload' }, { status: 400 });
	}
	const row = await saveJobPhoto(
		ctx,
		params.id!,
		{
			name: file.name,
			type: file.type,
			size: file.size,
			bytes: new Uint8Array(await file.arrayBuffer())
		},
		typeof form.get('phase') === 'string' ? String(form.get('phase')) : null
	);
	return json(row, { status: 201 });
};
