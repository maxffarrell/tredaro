import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, asc, desc, eq, gte, isNull, inArray, or, sql } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { BETTER_AUTH_SECRET } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import {
	agreementPlan,
	charge,
	companySettings,
	customer,
	equipment,
	estimate,
	estimateItem,
	invoice,
	job,
	jobEvent,
	jobType,
	member,
	payment,
	serviceAgreement,
	serviceLocation,
	user,
	outer
} from '#lib/server/db/schema.ts';
import { customerBalance } from './billing.ts';
import { estimateToken } from './estimates.ts';
import { providers } from '#lib/server/payments/index.ts';
import { providerRow } from '#lib/server/payments/settings.ts';
import { createJob } from './jobs.ts';
import { emit } from './events.ts';
import type * as s from '#lib/schemas.ts';
import type * as v from 'valibot';

const TTL_MS = 14 * 86400_000;

function sign(payload: string) {
	return createHmac('sha256', BETTER_AUTH_SECRET).update(`portal:${payload}`).digest('base64url');
}

/** A signed, expiring link that lets a customer attach their login to their customer record. */
export function portalToken(customerId: string) {
	const payload = `${customerId}.${Date.now() + TTL_MS}`;
	return `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`;
}

export async function hasPortalCustomer(userId: string) {
	const [row] = await db
		.select({ id: customer.id })
		.from(customer)
		.where(eq(customer.portalUserId, userId))
		.limit(1);
	return !!row;
}

export async function claimPortal(token: string, userId: string) {
	const [encoded, sig] = token.split('.');
	if (!encoded || !sig) error(400, 'Invalid link');
	const payload = Buffer.from(encoded, 'base64url').toString();
	const expected = Buffer.from(sign(payload));
	const given = Buffer.from(sig);
	if (expected.length !== given.length || !timingSafeEqual(expected, given))
		error(400, 'Invalid link');
	const [customerId, exp] = payload.split('.');
	if (!customerId || Number(exp) < Date.now())
		error(410, 'This link has expired. Ask your service company for a new one.');
	const [c] = await db
		.update(customer)
		.set({ portalUserId: userId })
		.where(eq(customer.id, customerId))
		.returning();
	if (!c) error(404, 'Customer not found');
	return c;
}

/** Everything the portal home shows for one customer record. */
export async function portalOverview(customerId: string) {
	const [c] = await db.select().from(customer).where(eq(customer.id, customerId));
	if (!c) error(404, 'Customer not found');
	const orgId = c.organizationId;

	const [settings] = await db
		.select()
		.from(companySettings)
		.where(eq(companySettings.organizationId, orgId));

	const agreements = await db
		.select({ agreement: serviceAgreement, plan: agreementPlan })
		.from(serviceAgreement)
		.innerJoin(agreementPlan, eq(serviceAgreement.planId, agreementPlan.id))
		.where(eq(serviceAgreement.customerId, customerId))
		.orderBy(desc(serviceAgreement.createdAt));

	const now = new Date();
	const upcoming = await db
		.select({
			job,
			jobTypeName: jobType.name,
			confirmed:
				sql<boolean>`exists (select 1 from ${jobEvent} e where e.job_id = ${job.id} and e.kind = 'confirmed')`.mapWith(
					Boolean
				),
			technicianName: user.name,
			address1: serviceLocation.address1,
			city: serviceLocation.city,
			state: serviceLocation.state
		})
		.from(job)
		.leftJoin(jobType, eq(job.jobTypeId, jobType.id))
		.leftJoin(serviceLocation, eq(job.serviceLocationId, serviceLocation.id))
		.leftJoin(member, eq(job.technicianId, member.id))
		.leftJoin(user, eq(member.userId, user.id))
		.where(
			and(
				eq(job.customerId, customerId),
				inArray(job.status, ['scheduled', 'dispatched', 'in_progress']),
				isNull(job.cancelledAt),
				or(isNull(job.startsAt), gte(job.endsAt, now))
			)
		)
		.orderBy(asc(job.startsAt));

	const history = await db
		.select({
			job,
			jobTypeName: jobType.name,
			invoiceNumber:
				sql<number>`(select i.number from ${invoice} i inner join ${charge} c2 on c2.invoice_id = i.id where c2.job_id = ${outer(job.id)} order by i.number limit 1)`.mapWith(
					Number
				)
		})
		.from(job)
		.leftJoin(jobType, eq(job.jobTypeId, jobType.id))
		.where(and(eq(job.customerId, customerId), eq(job.status, 'done'), isNull(job.cancelledAt)))
		.orderBy(desc(job.completedAt))
		.limit(12);

	const balance = await customerBalance(orgId, customerId);

	const openCharges = await db
		.select({
			charge,
			invoiceNumber: invoice.number,
			paid: sql<number>`coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${outer(charge.id)}), 0)`.mapWith(
				Number
			)
		})
		.from(charge)
		.leftJoin(invoice, eq(charge.invoiceId, invoice.id))
		.where(and(eq(charge.customerId, customerId), eq(charge.status, 'open')))
		.orderBy(asc(charge.dueDate));

	const locations = await db
		.select()
		.from(serviceLocation)
		.where(eq(serviceLocation.customerId, customerId))
		.orderBy(desc(serviceLocation.isPrimary), asc(serviceLocation.label));

	const units = await db
		.select({ equipment, locationLabel: serviceLocation.label })
		.from(equipment)
		.leftJoin(serviceLocation, eq(equipment.serviceLocationId, serviceLocation.id))
		.where(eq(equipment.customerId, customerId))
		.orderBy(desc(equipment.active), asc(equipment.name));

	const pendingEstimateRows = await db
		.select({
			estimate,
			total:
				sql<number>`coalesce((select sum(i.qty * i.unit_price) from ${estimateItem} i where i.estimate_id = ${outer(estimate.id)}), 0)`.mapWith(
					Number
				)
		})
		.from(estimate)
		.where(and(eq(estimate.customerId, customerId), eq(estimate.status, 'sent')))
		.orderBy(desc(estimate.sentAt));
	const pendingEstimates = pendingEstimateRows.map((row) => ({
		...row,
		token: estimateToken(row.estimate.id)
	}));

	return {
		customer: c,
		settings,
		agreements,
		upcoming,
		history,
		balance,
		openCharges,
		locations,
		units,
		pendingEstimates
	};
}

/** Customers request work on their own company's org context. */
const customerCtx = (orgId: string, userId: string) => ({
	orgId,
	userId,
	role: 'member' as const,
	org: { id: orgId, name: '', slug: '', logo: null }
});

/** A service request from the portal → an unscheduled job the dispatcher picks up. */
export async function requestService(
	orgId: string,
	userId: string,
	input: v.InferOutput<typeof s.portalRequestInput>
) {
	const [c] = await db
		.select()
		.from(customer)
		.where(
			and(
				eq(customer.organizationId, orgId),
				eq(customer.id, input.customerId),
				eq(customer.portalUserId, userId)
			)
		);
	if (!c) error(404, 'Customer not found');
	const row = await createJob(
		customerCtx(orgId, userId),
		'UTC',
		{
			customerId: c.id,
			serviceLocationId: input.serviceLocationId ?? null,
			jobTypeId: input.jobTypeId ?? null,
			summary: 'Portal request',
			description: input.description,
			preferredTime: input.preferredTime || null,
			priority: 'normal'
		},
		{ source: 'booking' }
	);
	return row;
}

/** Starts a provider checkout for the customer's full open balance. */
export async function portalCheckout(customerId: string, providerId: string) {
	const overview = await portalOverview(customerId);
	if (overview.balance <= 0) error(400, 'Nothing to pay');
	const provider = providers.find((p) => p.id === providerId);
	if (!provider?.configured()) error(404, 'Unknown provider');
	const row = await providerRow(overview.customer.organizationId, providerId);
	if (!provider.ready(row)) error(400, `${provider.name} is not available right now`);
	return provider.checkout({
		orgId: overview.customer.organizationId,
		customerId,
		email: overview.customer.email,
		amount: overview.balance,
		currency: overview.settings?.currency ?? 'usd',
		description: `Balance payment — ${overview.customer.name}`,
		row
	});
}

/** Which providers the customer can actually pay with right now. */
export async function availableProviders(orgId: string, currency: string) {
	const out = [];
	for (const p of providers) {
		if (!p.configured() || !p.supportsCurrency(currency)) continue;
		const row = await providerRow(orgId, p.id);
		if (p.ready(row)) out.push({ id: p.id, name: p.name, payLabel: p.payLabel, newTab: p.newTab });
	}
	return out;
}

/** Customer confirms a scheduled visit from the portal — writes a 'confirmed' job event. */
export async function confirmVisit(orgId: string, customerId: string, jobId: string) {
	const [j] = await db
		.select()
		.from(job)
		.where(
			and(
				eq(job.organizationId, orgId),
				eq(job.id, jobId),
				eq(job.customerId, customerId),
				inArray(job.status, ['scheduled', 'dispatched']),
				isNull(job.cancelledAt)
			)
		);
	if (!j) error(404, 'Visit not found or not confirmable');
	const [already] = await db
		.select({ id: jobEvent.id })
		.from(jobEvent)
		.where(and(eq(jobEvent.jobId, jobId), eq(jobEvent.kind, 'confirmed')))
		.limit(1);
	if (already) error(409, 'Already confirmed');
	await db
		.insert(jobEvent)
		.values({ organizationId: orgId, jobId, kind: 'confirmed', memberId: null });
	await emit({
		orgId,
		actorId: null,
		entityType: 'job',
		entityId: jobId,
		action: 'confirmed',
		summary: `J-${j.number} confirmed by customer`
	});
	return { confirmed: true };
}
