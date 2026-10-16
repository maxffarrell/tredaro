import { error, fail, isHttpError } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { and, eq } from 'drizzle-orm';
import { customer, job, jobType, serviceLocation } from '#lib/server/db/schema.ts';
import { requestReschedule, verifyBookingCancelToken } from '#lib/server/services/jobs.ts';
import { getSettings } from '#lib/server/services/settings.ts';

export const load: PageServerLoad = async ({ params }) => {
	const jobId = verifyBookingCancelToken(params.token!);
	if (!jobId) error(404, 'Visit not found');
	const [row] = await db
		.select({
			job,
			typeName: jobType.name,
			customerName: customer.name,
			location: serviceLocation
		})
		.from(job)
		.innerJoin(
			customer,
			and(eq(job.customerId, customer.id), eq(customer.organizationId, job.organizationId))
		)
		.leftJoin(
			jobType,
			and(eq(job.jobTypeId, jobType.id), eq(jobType.organizationId, job.organizationId))
		)
		.leftJoin(
			serviceLocation,
			and(
				eq(job.serviceLocationId, serviceLocation.id),
				eq(serviceLocation.organizationId, job.organizationId),
				eq(serviceLocation.customerId, job.customerId)
			)
		)
		.where(eq(job.id, jobId))
		.limit(1);
	if (!row) error(404, 'Visit not found');
	const settings = await getSettings(row.job.organizationId);
	return {
		orgName: settings.orgName,
		job: {
			number: row.job.number,
			summary: row.job.summary,
			startsAt: row.job.startsAt?.toISOString() ?? null,
			status: row.job.status
		},
		typeName: row.typeName,
		address: row.location
			? [row.location.address1, row.location.city, row.location.state].filter(Boolean).join(', ')
			: null,
		cancelled: row.job.status === 'cancelled' || !!row.job.cancelledAt,
		pendingRequest: row.job.preferredTime?.startsWith('Reschedule requested:')
			? row.job.preferredTime.slice('Reschedule requested:'.length).trim()
			: null
	};
};

export const actions: Actions = {
	default: async ({ params, request }) => {
		const jobId = verifyBookingCancelToken(params.token!);
		if (!jobId) return fail(404, { message: 'Visit not found' });
		const form = await request.formData();
		const date = String(form.get('date') ?? '')
			.trim()
			.slice(0, 10);
		const slot = String(form.get('slot') ?? '')
			.trim()
			.slice(0, 120);
		const note = String(form.get('note') ?? '')
			.trim()
			.slice(0, 500);
		if (!date && !slot) return fail(400, { message: 'Pick a day or a time window' });
		try {
			await requestReschedule(jobId, { date, slot, note });
		} catch (err) {
			if (isHttpError(err, 404)) return fail(404, { message: 'Visit not found' });
			return fail(409, { message: 'This visit can no longer be changed online' });
		}
		return { sent: true };
	}
};
