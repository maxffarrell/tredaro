import { createHmac, timingSafeEqual } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { and, asc, eq, gte, lt, ne } from 'drizzle-orm';
import { BETTER_AUTH_SECRET } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { customer, job, member, organization, serviceLocation } from '#lib/server/db/schema.ts';
import type { RequestHandler } from './$types';

const sign = (payload: string) =>
	createHmac('sha256', BETTER_AUTH_SECRET).update(`cal:${payload}`).digest('base64url');

const ics = (d: Date) =>
	d
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}/, '');
const esc = (s: string) =>
	s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const fold = (line: string) => {
	// RFC 5545: lines ≤75 octets, continuations start with a space. ASCII-safe split.
	const out: string[] = [];
	while (line.length > 74) {
		out.push(line.slice(0, 74));
		line = ' ' + line.slice(74);
	}
	out.push(line);
	return out.join('\r\n');
};

/** Per-tech iCal feed: `GET /api/cal/<memberId>.<hmac>` — subscribe in Google/Outlook/Apple calendars. */
export const GET: RequestHandler = async ({ params }) => {
	const [memberId, sig] = (params.token ?? '').split('.');
	if (!memberId || !sig) error(404, 'Not found');
	const expected = sign(memberId);
	if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
		error(404, 'Not found');

	const [me] = await db
		.select({ member: member, orgName: organization.name })
		.from(member)
		.innerJoin(organization, eq(member.organizationId, organization.id))
		.where(eq(member.id, memberId))
		.limit(1);
	if (!me) error(404, 'Not found');

	const now = new Date();
	const from = new Date(now.getTime() - 30 * 86400_000);
	const to = new Date(now.getTime() + 90 * 86400_000);
	const jobs = await db
		.select({ job, customerName: customer.name, loc: serviceLocation })
		.from(job)
		.innerJoin(
			customer,
			and(eq(job.customerId, customer.id), eq(customer.organizationId, job.organizationId))
		)
		.leftJoin(serviceLocation, eq(job.serviceLocationId, serviceLocation.id))
		.where(
			and(
				eq(job.organizationId, me.member.organizationId),
				eq(job.technicianId, memberId),
				ne(job.status, 'cancelled'),
				gte(job.startsAt, from),
				lt(job.startsAt, to)
			)
		)
		.orderBy(asc(job.startsAt));

	const body = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Tredaro//Dispatch//EN',
		`X-WR-CALNAME:${esc(`${me.orgName} · My jobs`)}`,
		'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
		...jobs.flatMap((j) => {
			const start = j.job.startsAt ?? j.job.createdAt;
			const end = j.job.endsAt ?? new Date(start.getTime() + 3600_000);
			const address = j.loc
				? [j.loc.address1, [j.loc.city, j.loc.state].filter(Boolean).join(' '), j.loc.zip]
						.filter(Boolean)
						.join(', ')
				: '';
			return [
				'BEGIN:VEVENT',
				`UID:job-${j.job.id}@tredaro`,
				`DTSTAMP:${ics(now)}`,
				`DTSTART:${ics(start)}`,
				`DTEND:${ics(end)}`,
				fold(`SUMMARY:${esc(`J-${j.job.number} · ${j.customerName} — ${j.job.summary}`)}`),
				...(address ? [fold(`LOCATION:${esc(address)}`)] : []),
				fold(
					`DESCRIPTION:${esc(`${j.job.summary}${j.job.description ? `\\n${j.job.description}` : ''}`)}`
				),
				`STATUS:${j.job.status === 'done' ? 'COMPLETED' : 'CONFIRMED'}`,
				'END:VEVENT'
			];
		}),
		'END:VCALENDAR'
	].join('\r\n');

	return new Response(body, {
		headers: {
			'content-type': 'text/calendar; charset=utf-8',
			'cache-control': 'no-store',
			'content-disposition': `inline; filename="schedule.ics"`
		}
	});
};
