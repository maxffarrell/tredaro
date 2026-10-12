import { error, type RequestHandler } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { requireUser } from '#lib/server/context.ts';
import { db } from '#lib/server/db/index.ts';
import { customer, job, jobType, organization, serviceLocation } from '#lib/server/db/schema.ts';

const esc = (v: string) =>
	v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (d: Date) =>
	d
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}/, '');

/**
 * `GET /api/portal/ics?job=<id>` — a downloadable calendar event for one of the
 * signed-in portal customer's scheduled visits.
 */
export const GET: RequestHandler = async ({ url }) => {
	const { user } = requireUser();
	const jobId = url.searchParams.get('job') ?? '';
	const [row] = await db
		.select({
			job,
			typeName: jobType.name,
			orgName: organization.name,
			location: serviceLocation
		})
		.from(job)
		.innerJoin(
			customer,
			and(eq(job.customerId, customer.id), eq(customer.organizationId, job.organizationId))
		)
		.innerJoin(organization, eq(organization.id, job.organizationId))
		.leftJoin(jobType, eq(job.jobTypeId, jobType.id))
		.leftJoin(serviceLocation, eq(job.serviceLocationId, serviceLocation.id))
		.where(and(eq(job.id, jobId), eq(customer.portalUserId, user.id)))
		.limit(1);
	if (!row?.job.startsAt) error(404, 'Visit not found');
	if (['done', 'cancelled'].includes(row.job.status)) error(410, 'Visit is no longer scheduled');

	const loc = row.location
		? [
				row.location.address1,
				[row.location.city, row.location.state].filter(Boolean).join(' '),
				row.location.zip
			]
				.filter(Boolean)
				.join(', ')
		: '';
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Tredaro//Visit//EN',
		'BEGIN:VEVENT',
		`UID:job-${row.job.id}@tredaro`,
		`DTSTAMP:${stamp(new Date())}`,
		`DTSTART:${stamp(row.job.startsAt)}`,
		`DTEND:${stamp(row.job.endsAt ?? new Date(row.job.startsAt.getTime() + 3600_000))}`,
		`SUMMARY:${esc(`${row.orgName} — ${row.typeName ?? row.job.summary ?? 'Service visit'}`)}`,
		...(loc ? [`LOCATION:${esc(loc)}`] : []),
		`DESCRIPTION:${esc(`Visit J-${row.job.number} with ${row.orgName}${row.job.arrivalWindow ? ` — arrival window ${row.job.arrivalWindow}` : ''}`)}`,
		'END:VEVENT',
		'END:VCALENDAR'
	];
	return new Response(lines.join('\r\n'), {
		headers: {
			'content-type': 'text/calendar; charset=utf-8',
			'content-disposition': `attachment; filename="visit-j${row.job.number}.ics"`
		}
	});
};
