import { json, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { requireUser } from '#lib/server/context.ts';
import { db } from '#lib/server/db/index.ts';
import { customer, job } from '#lib/server/db/schema.ts';
import { saveJobPhoto } from '#lib/server/services/photos.ts';
import type { RequestHandler } from './$types';

/**
 * Portal photo upload: `POST /api/portal/photos` (multipart `file` + `jobId`).
 * The job must belong to a customer the signed-in portal user is linked to;
 * uploads land as 'before' photos the dispatcher can see right away.
 */
export const POST: RequestHandler = async ({ request }) => {
	const { user } = requireUser();
	const form = await request.formData();
	const file = form.get('file');
	const jobId = String(form.get('jobId') ?? '');
	if (!(file instanceof File) || file.size === 0) {
		return json({ message: 'Attach a file to upload' }, { status: 400 });
	}
	const [j] = await db
		.select({ id: job.id, orgId: job.organizationId })
		.from(job)
		.innerJoin(customer, eq(job.customerId, customer.id))
		.where(and(eq(job.id, jobId), eq(customer.portalUserId, user.id)))
		.limit(1);
	if (!j) error(404, 'Job not found');
	const row = await saveJobPhoto(
		{
			orgId: j.orgId,
			userId: user.id,
			role: 'member',
			org: { id: j.orgId, name: '', slug: '', logo: null }
		},
		jobId,
		{
			name: file.name,
			type: file.type,
			size: file.size,
			bytes: new Uint8Array(await file.arrayBuffer())
		},
		'before'
	);
	return json(row, { status: 201 });
};
