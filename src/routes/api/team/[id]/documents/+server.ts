import { json, type RequestHandler } from '@sveltejs/kit';
import { requireOrg } from '#lib/server/context.ts';
import { saveMemberDoc } from '#lib/server/services/photos.ts';

/** Upload a document to a team member: `POST /api/team/<memberId>/documents` (multipart `file`, optional `label`, `expiresOn`). */
export const POST: RequestHandler = async ({ params, request }) => {
	const ctx = await requireOrg();
	const form = await request.formData();
	const file = form.get('file');
	if (!(file instanceof File) || file.size === 0) {
		return json({ message: 'Attach a file to upload' }, { status: 400 });
	}
	const label = String(form.get('label') ?? '').trim();
	const expiresOn = String(form.get('expiresOn') ?? '').trim() || null;
	const row = await saveMemberDoc(ctx, params.id!, label, {
		name: file.name,
		type: file.type,
		size: file.size,
		bytes: new Uint8Array(await file.arrayBuffer())
	});
	if (expiresOn) {
		const { setMemberDocExpiry } = await import('#lib/server/services/photos.ts');
		await setMemberDocExpiry(ctx, row.id, expiresOn);
	}
	return json(row, { status: 201 });
};
