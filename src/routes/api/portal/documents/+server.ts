import { json } from '@sveltejs/kit';
import { requireUser } from '#lib/server/context.ts';
import { savePortalCustomerDoc } from '#lib/server/services/photos.ts';
import { notifyStaffDocument } from '#lib/server/services/notifications.ts';
import type { RequestHandler } from './$types';

/**
 * Portal document upload: `POST /api/portal/documents` (multipart `file` + `customerId`).
 * The customer must be linked to the signed-in portal user; the file lands on the
 * customer's Documents card flagged "from customer" and staff get an alert.
 */
export const POST: RequestHandler = async ({ request }) => {
	const { user } = requireUser();
	const form = await request.formData();
	const file = form.get('file');
	const customerId = String(form.get('customerId') ?? '');
	if (!(file instanceof File) || file.size === 0) {
		return json({ message: 'Attach a file to upload' }, { status: 400 });
	}
	const { row, orgId } = await savePortalCustomerDoc(user.id, customerId, {
		name: file.name,
		type: file.type,
		size: file.size,
		bytes: new Uint8Array(await file.arrayBuffer())
	});
	await notifyStaffDocument(orgId, row.id);
	return json(row, { status: 201 });
};
