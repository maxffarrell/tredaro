import { json, type RequestHandler } from '@sveltejs/kit';
import { requireOrg } from '#lib/server/context.ts';
import { saveEquipmentPhoto } from '#lib/server/services/photos.ts';

/** Upload/replace a photo on an equipment unit: `POST /api/equipment/<id>/photo` (multipart `file`). */
export const POST: RequestHandler = async ({ params, request }) => {
	const ctx = await requireOrg();
	const form = await request.formData();
	const file = form.get('file');
	if (!(file instanceof File) || file.size === 0) {
		return json({ message: 'Attach a file to upload' }, { status: 400 });
	}
	await saveEquipmentPhoto(ctx, params.id!, {
		name: file.name,
		type: file.type,
		size: file.size,
		bytes: new Uint8Array(await file.arrayBuffer())
	});
	return json({ ok: true }, { status: 201 });
};
