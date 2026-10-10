import { error } from '@sveltejs/kit';
import { and, asc, eq, like, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	agreementPlan,
	companySettings,
	customer,
	estimate,
	job,
	jobType,
	office,
	organization,
	serviceLocation
} from '#lib/server/db/schema.ts';
import { member, user } from '#lib/server/db/auth.schema.ts';
import { emit } from './events.ts';
import { createJob } from './jobs.ts';
import { verifyEstimateToken } from './estimates.ts';
import { providers } from '#lib/server/payments/index.ts';
import { providerRow } from '#lib/server/payments/settings.ts';
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
		.where(
			and(eq(jobType.organizationId, org.id), eq(jobType.active, true), eq(jobType.bookable, true))
		)
		.orderBy(asc(jobType.name));

	const offices = await db
		.select({ name: office.name, address: office.address })
		.from(office)
		.where(eq(office.organizationId, org.id))
		.orderBy(asc(office.name));

	const techs = await db
		.select({ id: member.id, name: user.name })
		.from(member)
		.innerJoin(user, eq(member.userId, user.id))
		.where(eq(member.organizationId, org.id))
		.orderBy(asc(user.name));

	return { org, settings, plans, jobTypes, offices, techs };
}

/**
 * Open public-booking slots left on a requested day. `limited:false` means the
 * org doesn't cap daily bookings — every day is open.
 */
export async function publicAvailability(slug: string, dateIso: string) {
	const { org, settings } = await getPublicCompany(slug);
	if (!settings || settings.bookingDailyLimit <= 0) return { limited: false, remaining: 0 };
	const [{ taken }] = await db
		.select({ taken: sql<number>`count(*)`.mapWith(Number) })
		.from(job)
		.where(
			and(
				eq(job.organizationId, org.id),
				eq(job.source, 'booking'),
				like(job.preferredTime, `${dateIso}%`),
				sql`${job.cancelledAt} is null`
			)
		);
	return { limited: true, remaining: Math.max(0, settings.bookingDailyLimit - taken) };
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
	if (settings && !settings.bookingEnabled)
		error(400, 'Online booking is currently closed — please call us directly.');

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

	// Horizon rule: when set, the requested day can't be farther than
	// bookingMaxDaysAhead out.
	if (settings.bookingMaxDaysAhead > 0 && input.preferredTime) {
		const m = /^(\d{4}-\d{2}-\d{2})/.exec(input.preferredTime);
		if (m) {
			const max = new Date();
			max.setDate(max.getDate() + settings.bookingMaxDaysAhead);
			const maxDay = max.toISOString().slice(0, 10);
			if (m[1] > maxDay) error(400, `Latest available day is ${maxDay} — pick an earlier date`);
		}
	}

	// Service-area check: when the org lists ZIPs, the site ZIP must be one of them.
	const allowedZips = settings.serviceZips
		.split(',')
		.map((z) => z.trim())
		.filter(Boolean);
	if (allowedZips.length > 0) {
		const z = input.zip.trim();
		if (!z || !allowedZips.includes(z))
			error(400, 'Sorry, that address is outside our service area.');
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

	// Closed days: comma-separated YYYY-MM-DD blackout dates (holidays/closures).
	if (settings.bookingBlackouts && input.preferredTime) {
		const m = /^(\d{4}-\d{2}-\d{2})/.exec(input.preferredTime);
		const closed = settings.bookingBlackouts
			.split(',')
			.map((d) => d.trim())
			.filter(Boolean);
		if (m && closed.includes(m[1])) error(400, "We're closed that day — pick another date.");
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
					phone: input.phone,
					leadSource: input.leadSource || null
				})
				.returning()
		)[0]!;

	// A matched repeat customer who gave a lead source fills in the blank only.
	if (input.leadSource && !c.leadSource)
		await db.update(customer).set({ leadSource: input.leadSource }).where(eq(customer.id, c.id));

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

	// Optional preferred-tech choice — must be a member of this org.
	let techId: string | null = null;
	if (input.preferredMemberId) {
		const [m] = await db
			.select({ id: member.id })
			.from(member)
			.where(and(eq(member.organizationId, org.id), eq(member.id, input.preferredMemberId)))
			.limit(1);
		if (!m) error(400, 'Invalid technician');
		techId = m.id;
		if (!c.preferredMemberId)
			await db.update(customer).set({ preferredMemberId: m.id }).where(eq(customer.id, c.id));
	}

	const j = await createJob(
		{ orgId: org.id, userId: null },
		settings?.timezone ?? 'UTC',
		{
			customerId: c.id,
			technicianId: techId,
			serviceLocationId: locationId,
			jobTypeId: input.jobTypeId ?? null,
			summary: 'Website booking request',
			description: input.description,
			preferredTime: input.preferredTime || null,
			priority: 'normal'
		},
		{ source: 'booking' }
	);
	if (settings.bookingReview)
		await db.update(job).set({ needsReview: true }).where(eq(job.id, j.id));

	await emit({
		orgId: org.id,
		entityType: 'customer',
		entityId: c.id,
		action: 'booking-requested',
		summary: `${input.name} requested service via /book/${slug}`
	});
	// Booking deposit: when configured and a payment provider is ready, the
	// requester is sent through checkout right after submitting. The payment
	// lands as unapplied credit and auto-applies to their first invoice.
	let payUrl: string | null = null;
	if (settings.bookingDeposit > 0) {
		// A provider outage or revoked key must never lose the booking — the job
		// and customer are already persisted, so fall back to collecting on the
		// first invoice instead of erroring (which would invite duplicate retries).
		try {
			for (const p of providers) {
				if (!p.configured()) continue;
				const row = await providerRow(org.id, p.id);
				if (!p.ready(row)) continue;
				payUrl = await p.checkout({
					orgId: org.id,
					customerId: c.id,
					email: input.email,
					amount: settings.bookingDeposit,
					currency: settings.currency ?? 'usd',
					description: `Booking deposit — ${org.name}`,
					paths: { success: `/book/${slug}?paid=1`, cancel: `/book/${slug}` },
					row
				});
				break;
			}
		} catch (err) {
			console.error('booking deposit checkout failed', err);
			payUrl = null;
		}
	}

	return { job: j, customer: c, payUrl };
}

/**
 * Post-approval "when works best": the customer names their preferred timing on the
 * public estimate link — stored as the generated job's preferredTime for dispatch.
 */
export async function setVisitPreference(token: string, note: string) {
	const estimateId = verifyEstimateToken(token);
	if (!estimateId) error(404, 'Estimate not found');
	const [est] = await db.select().from(estimate).where(eq(estimate.id, estimateId));
	if (!est) error(404, 'Estimate not found');
	if (!est.jobId) error(409, 'No visit to schedule yet');
	await db.update(job).set({ preferredTime: note }).where(eq(job.id, est.jobId));
	await emit({
		orgId: est.organizationId,
		entityType: 'job',
		entityId: est.jobId,
		action: 'visit_preference',
		summary: `Customer asked for "${note.slice(0, 200)}" after approving E-${est.number}`
	});
	const { notifyVisitPreference } = await import('./notifications.ts');
	void notifyVisitPreference(est.organizationId, est.jobId, note).catch((err) =>
		console.error('visit preference alert failed', err)
	);
	return { ok: true };
}
