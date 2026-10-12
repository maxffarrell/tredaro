import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { and, eq } from 'drizzle-orm';
import { customer, job, jobType, serviceLocation } from '#lib/server/db/schema.ts';
import { cancelBookedJob, verifyBookingCancelToken } from '#lib/server/services/jobs.ts';
import { getSettings } from '#lib/server/services/settings.ts';

export const load: PageServerLoad = async ({ params }) => {
	const jobId = verifyBookingCancelToken(params.token!);
	if (!jobId) error(404, 'This link is invalid or has expired');
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
		.leftJoin(jobType, eq(job.jobTypeId, jobType.id))
		.leftJoin(
			serviceLocation,
			and(
				eq(job.serviceLocationId, serviceLocation.id),
				eq(serviceLocation.organizationId, job.organizationId)
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
		cancelled: row.job.status === 'cancelled' || !!row.job.cancelledAt
	};
};

export const actions: Actions = {
	default: async ({ params }) => {
		const jobId = verifyBookingCancelToken(params.token!);
		if (!jobId) return fail(404, { message: 'This link is invalid or has expired' });
		const { already } = await cancelBookedJob(jobId);
		return { cancelled: true, already };
	}
};
