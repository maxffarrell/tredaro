import { error } from '@sveltejs/kit';
import { and, asc, eq, like, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	agreementPlan,
	companySettings,
	customer,
	job,
	jobType,
	office,
	organization,
	serviceLocation
} from '#lib/server/db/schema.ts';
import { emit } from './events.ts';
import { createJob } from './jobs.ts';
import type * as s from '#lib/schemas.ts';
import type * as v from 'valibot';

/** Public booking page at /book/[slug]: identity, listed agreement plans, job types and offices. */
export async function getPublicCompany(slug: string) {
	const [org] = await db.select().from(organization).where(eq(organization.slug, slug));
	if (!org) error(404, 'Not found');
	const [settings] = await db
		.select()
		.from(companySettings)
		.where(eq(companySettings.organizationId, org.id));
	if (!settings?.publicPage) error(404, 'Not found');

	const plans = await db
		.select()
		.from(agreementPlan)
		.where(
			and(
				eq(agreementPlan.organizationId, org.id),
				eq(agreementPlan.active, true),
				eq(agreementPlan.listed, true)
			)
		)
		.orderBy(asc(agreementPlan.amount));

	const jobTypes = await db
		.select({
			id: jobType.id,
			name: jobType.name,
			description: jobType.description,
			defaultAmount: jobType.defaultAmount
		})
		.from(jobType)
		.where(and(eq(jobType.organizationId, org.id), eq(jobType.active, true)))
		.orderBy(asc(jobType.name));

	const offices = await db
		.select({ name: office.name, address: office.address })
		.from(office)
		.where(eq(office.organizationId, org.id))
		.orderBy(asc(office.name));

	return { org, settings, plans, jobTypes, offices };
}

const bookRate = new Map<string, number[]>();

/**
 * Public booking form → customer (+ service location) and an unscheduled job the
 * dispatcher picks up. Rate-limited per IP and honeypot-guarded.
 */
export async function requestBooking(
	slug: string,
	ip: string,
	input: v.InferOutput<typeof s.bookingInput>
) {
	if (input.website) error(400, 'Invalid form'); // honeypot
	const now = Date.now();
	const hits = (bookRate.get(ip) ?? []).filter((t) => now - t < 3600_000);
	if (hits.length >= 10) error(429, 'Too many attempts — try again later');
	bookRate.set(ip, [...hits, now]);

	const { org, settings } = await getPublicCompany(slug);

	// Advance-notice rule: when set, the requested day must be at least
	// bookingNoticeDays out. The UI prefixes preferredTime with YYYY-MM-DD.
	if (settings.bookingNoticeDays > 0 && input.preferredTime) {
		const m = /^(\d{4}-\d{2}-\d{2})/.exec(input.preferredTime);
		if (m) {
			const min = new Date();
			min.setDate(min.getDate() + settings.bookingNoticeDays);
			const minDay = min.toISOString().slice(0, 10);
			if (m[1] < minDay) error(400, `Earliest available day is ${minDay} — pick a later date`);
		}
	}

	// Daily cap: at most bookingDailyLimit public bookings for the requested day.
	if (settings.bookingDailyLimit > 0 && input.preferredTime) {
		const m = /^(\d{4}-\d{2}-\d{2})/.exec(input.preferredTime);
		if (m) {
			const [{ taken }] = await db
				.select({ taken: sql<number>`count(*)`.mapWith(Number) })
				.from(job)
				.where(
					and(
						eq(job.organizationId, org.id),
						eq(job.source, 'booking'),
						like(job.preferredTime, `${m[1]}%`),
						sql`${job.cancelledAt} is null`
					)
				);
			if (taken >= settings.bookingDailyLimit)
				error(400, 'That day is fully booked — please pick another');
		}
	}

	// Reuse an existing customer with the same email (or same phone digits when the
	// email doesn't match) rather than stacking duplicates from repeat bookings.
	const [existing] = await db
		.select()
		.from(customer)
		.where(and(eq(customer.organizationId, org.id), eq(customer.email, input.email)))
		.limit(1);
	const digits = input.phone.replace(/\D/g, '').slice(-10);
	const [phoneMatch] =
		!existing && digits.length >= 7
			? await db
					.select()
					.from(customer)
					.where(
						and(
							eq(customer.organizationId, org.id),
							sql`regexp_replace(${customer.phone}, '\\D', '', 'g') like ${'%' + digits}`
						)
					)
					.limit(1)
			: [undefined];

	const c =
		existing ??
		phoneMatch ??
		(
			await db
				.insert(customer)
				.values({
					organizationId: org.id,
					name: input.name,
					email: input.email,
					phone: input.phone
				})
				.returning()
		)[0]!;

	let locationId: string | null = null;
	if (input.address1) {
		const [loc] = await db
			.insert(serviceLocation)
			.values({
				organizationId: org.id,
				customerId: c.id,
				address1: input.address1,
				city: input.city,
				state: input.state,
				zip: input.zip,
				isPrimary: !existing
			})
			.returning();
		locationId = loc!.id;
	} else if (existing) {
		const [primary] = await db
			.select({ id: serviceLocation.id })
			.from(serviceLocation)
			.where(and(eq(serviceLocation.customerId, c.id), eq(serviceLocation.isPrimary, true)))
			.limit(1);
		locationId = primary?.id ?? null;
	}

	const j = await createJob(
		{ orgId: org.id, userId: null },
		settings?.timezone ?? 'UTC',
		{
			customerId: c.id,
			serviceLocationId: locationId,
			jobTypeId: input.jobTypeId ?? null,
			summary: 'Website booking request',
			description: input.description,
			preferredTime: input.preferredTime || null,
			priority: 'normal'
		},
		{ source: 'booking' }
	);

	await emit({
		orgId: org.id,
		entityType: 'customer',
		entityId: c.id,
		action: 'booking-requested',
		summary: `${input.name} requested service via /book/${slug}`
	});
	return { job: j, customer: c };
}
