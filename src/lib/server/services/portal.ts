import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, asc, desc, eq, gte, isNull, inArray, like, or, sql } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { BETTER_AUTH_SECRET } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import {
	agreementPlan,
	charge,
	companySettings,
	customer,
	customerDocument,
	equipment,
	estimate,
	estimateItem,
	invoice,
	job,
	jobDocument,
	jobEvent,
	jobPhoto,
	jobType,
	member,
	notificationLog,
	payment,
	serviceAgreement,
	serviceLocation,
	user,
	outer
} from '#lib/server/db/schema.ts';
import { customerBalance, invoiceUrl } from './billing.ts';
import { estimateToken } from './estimates.ts';
import { providers } from '#lib/server/payments/index.ts';
import { providerRow } from '#lib/server/payments/settings.ts';
import { createJob } from './jobs.ts';
import { emit } from './events.ts';
import { notifyChargeDispute, notifyStaffVisitCancel } from './notifications.ts';
import { nextNumber } from './settings.ts';
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
			cancelRequested:
				sql<boolean>`exists (select 1 from ${jobEvent} e where e.job_id = ${job.id} and e.kind = 'note' and e.note like 'Customer requested cancellation%')`.mapWith(
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
			photos: sql<
				string[]
			>`coalesce((select array_agg(p.id) from ${jobPhoto} p where p.job_id = ${job.id} and p.shared), '{}')`,
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

	const recentInvoices = await db
		.select({
			invoice,
			total:
				sql<number>`coalesce((select sum(i.qty * i.unit_price) from invoice_item i where i.invoice_id = ${outer(invoice.id)}), 0)`.mapWith(
					Number
				),
			paid: sql<number>`coalesce((select sum(p.amount) from ${payment} p join ${charge} c on c.id = p.charge_id where c.invoice_id = ${outer(invoice.id)}), 0)`.mapWith(
				Number
			)
		})
		.from(invoice)
		.where(and(eq(invoice.organizationId, orgId), eq(invoice.customerId, customerId)))
		.orderBy(desc(invoice.createdAt))
		.limit(5);

	const invoicesWithLinks = recentInvoices.map((row) => ({
		...row,
		url: invoiceUrl(row.invoice.id)
	}));

	const recentPayments = await db
		.select({
			payment,
			invoiceNumber: invoice.number
		})
		.from(payment)
		.leftJoin(charge, eq(payment.chargeId, charge.id))
		.leftJoin(invoice, eq(charge.invoiceId, invoice.id))
		.where(eq(payment.customerId, customerId))
		.orderBy(desc(payment.createdAt))
		.limit(8);

	const techs = await db
		.select({ id: member.id, name: user.name })
		.from(member)
		.innerJoin(user, eq(member.userId, user.id))
		.where(eq(member.organizationId, orgId))
		.orderBy(asc(user.name));

	// Outbound comms addressed to this customer — the portal's "Recent messages" card.
	const contacts = [c.email, c.phone].filter((v): v is string => !!v);
	const recentMessages = contacts.length
		? await db
				.select({
					id: notificationLog.id,
					kind: notificationLog.kind,
					channel: sql<string>`case when ${notificationLog.recipient} = ${c.phone ?? ''} then 'text' else 'email' end`,
					createdAt: notificationLog.createdAt
				})
				.from(notificationLog)
				.where(
					and(
						eq(notificationLog.organizationId, orgId),
						inArray(notificationLog.recipient, contacts),
						inArray(notificationLog.kind, PORTAL_MESSAGE_KINDS)
					)
				)
				.orderBy(desc(notificationLog.createdAt))
				.limit(8)
		: [];

	const [customerDocs, jobDocs] = await Promise.all([
		db
			.select({
				id: customerDocument.id,
				fileName: customerDocument.fileName,
				mime: customerDocument.mime,
				size: customerDocument.size,
				createdAt: customerDocument.createdAt
			})
			.from(customerDocument)
			.where(
				and(
					eq(customerDocument.customerId, customerId),
					or(eq(customerDocument.shared, true), eq(customerDocument.viaPortal, true))
				)
			)
			.orderBy(desc(customerDocument.createdAt)),
		db
			.select({
				id: jobDocument.id,
				fileName: jobDocument.fileName,
				mime: jobDocument.mime,
				size: jobDocument.size,
				createdAt: jobDocument.createdAt,
				jobNumber: job.number
			})
			.from(jobDocument)
			.innerJoin(job, eq(jobDocument.jobId, job.id))
			.where(and(eq(job.customerId, customerId), eq(jobDocument.shared, true)))
			.orderBy(desc(jobDocument.createdAt))
	]);
	const documents = [
		...customerDocs.map((d) => ({
			...d,
			jobNumber: null as number | null,
			href: `/files/portal-customer-document/${d.id}`
		})),
		...jobDocs.map((d) => ({ ...d, href: `/files/portal-job-document/${d.id}` }))
	].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

	return {
		customer: c,
		techs,
		settings,
		agreements,
		upcoming,
		history,
		balance,
		openCharges,
		locations,
		units,
		pendingEstimates,
		recentInvoices: invoicesWithLinks,
		recentPayments,
		documents,
		recentMessages
	};
}

/** notification_log kinds the customer may see in the portal — staff-only kinds excluded. */
const PORTAL_MESSAGE_KINDS = [
	'appointment_reminder',
	'appointment_reminder_sms',
	'booking_received',
	'booking_sms',
	'booking_cancelled',
	'estimate_sent',
	'estimate_sent_sms',
	'estimate_resent',
	'estimate_resent_sms',
	'estimate_followup',
	'estimate_followup_sms',
	'estimate_expiring',
	'invoice_sent',
	'invoice_texted',
	'job_scheduled',
	'job_scheduled_sms',
	'job_en_route_sms',
	'job_eta_sms',
	'job_completed',
	'job_completed_sms',
	'job_rescheduled',
	'job_rescheduled_sms',
	'payment_receipt',
	'payment_receipt_sms',
	'agreement_renewal',
	'agreement_renewal_sms',
	'announcement',
	'announcement_sms',
	'statement',
	'report_sent',
	'report_sent_sms',
	'rating_sms_ask',
	'review_ask',
	'manual_sms',
	'customer_document',
	'warranty_expiry',
	'service_due',
	'service_due_sms',
	'invoice_overdue_3',
	'invoice_overdue_10',
	'invoice_overdue_sms_3',
	'invoice_overdue_sms_10',
	'statement_auto',
	'job_running_late'
] as const;

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
	let techId: string | null = null;
	if (input.preferredMemberId) {
		const [m] = await db
			.select({ id: member.id })
			.from(member)
			.where(and(eq(member.organizationId, orgId), eq(member.id, input.preferredMemberId)))
			.limit(1);
		if (!m) error(400, 'Invalid technician');
		techId = m.id;
	}
	if (input.requestType === 'quote') {
		const estNumber = await nextNumber(orgId, 'estimate');
		const [est] = await db
			.insert(estimate)
			.values({
				organizationId: orgId,
				number: estNumber,
				customerId: c.id,
				serviceLocationId: input.serviceLocationId ?? null,
				notes: `Portal quote request — ${input.description || 'no details'}${input.preferredTime ? ` (preferred: ${input.preferredTime})` : ''}`
			})
			.returning();
		await emit({
			orgId,
			actorId: userId,
			entityType: 'estimate',
			entityId: est!.id,
			action: 'quote-requested',
			summary: `${c.name} requested a quote via the portal`
		});
		return { job: null, estimate: est };
	}

	let equipmentId: string | null = null;
	if (input.equipmentId) {
		const [u] = await db
			.select({ id: equipment.id })
			.from(equipment)
			.where(and(eq(equipment.id, input.equipmentId), eq(equipment.customerId, c.id)))
			.limit(1);
		if (!u) error(400, 'Invalid equipment');
		equipmentId = u.id;
	}
	const row = await createJob(
		customerCtx(orgId, userId),
		'UTC',
		{
			customerId: c.id,
			technicianId: techId,
			serviceLocationId: input.serviceLocationId ?? null,
			jobTypeId: input.jobTypeId ?? null,
			summary: 'Portal request',
			description: input.description,
			preferredTime: input.preferredTime || null,
			priority: 'normal',
			equipmentId
		},
		{ source: 'booking' }
	);
	return { job: row, estimate: null };
}

/**
 * Starts a provider checkout. `chargeIds` limits payment to that selection of open
 * charges (per-charge portal pay); omitted = full open balance.
 */
export async function portalCheckout(customerId: string, providerId: string, chargeIds?: string[]) {
	const overview = await portalOverview(customerId);
	if (overview.balance <= 0) error(400, 'Nothing to pay');
	const provider = providers.find((p) => p.id === providerId);
	if (!provider?.configured()) error(404, 'Unknown provider');
	const row = await providerRow(overview.customer.organizationId, providerId);
	if (!provider.ready(row)) error(400, `${provider.name} is not available right now`);
	let amount = overview.balance;
	let meta: Record<string, string> | undefined;
	if (chargeIds?.length) {
		const wanted = new Set(chargeIds);
		const picked = overview.openCharges.filter((c) => wanted.has(c.charge.id));
		amount = picked.reduce((sum, c) => sum + (c.charge.amount - c.paid), 0);
		if (!picked.length || amount <= 0) error(400, 'Selected charges are already paid');
		meta = { tredaroChargeIds: picked.map((c) => c.charge.id).join(',') };
	}
	return provider.checkout({
		orgId: overview.customer.organizationId,
		customerId,
		email: overview.customer.email,
		amount,
		currency: overview.settings?.currency ?? 'usd',
		description: `Balance payment — ${overview.customer.name}`,
		meta,
		row
	});
}

/** Portal self-service: hosted page where the customer saves a card for auto-charges. */
export async function portalSaveCard(customerId: string, providerId: string) {
	const overview = await portalOverview(customerId);
	const provider = providers.find((p) => p.id === providerId);
	if (!provider?.configured() || !provider.saveCard) error(404, 'Unknown provider');
	const row = await providerRow(overview.customer.organizationId, providerId);
	if (!provider.ready(row)) error(400, `${provider.name} is not available right now`);
	return provider.saveCard({
		orgId: overview.customer.organizationId,
		customerId,
		email: overview.customer.email,
		amount: 0,
		currency: overview.settings?.currency ?? 'usd',
		description: `Card on file — ${overview.customer.name}`,
		row
	});
}

/** Which providers the customer can actually pay with right now. */
export async function availableProviders(orgId: string, currency: string) {
	const out = [];
	for (const p of providers) {
		if (!p.configured() || !p.supportsCurrency(currency)) continue;
		const row = await providerRow(orgId, p.id);
		if (p.ready(row))
			out.push({
				id: p.id,
				name: p.name,
				payLabel: p.payLabel,
				newTab: p.newTab,
				canSaveCard: !!p.saveCard
			});
	}
	return out;
}

/** Portal self-service: the customer updates their own email/phone. */
export async function updatePortalContact(
	userId: string,
	customerId: string,
	input: {
		email?: string;
		phone?: string;
		smsOptOut?: boolean;
		emailOptOut?: boolean;
		accessNotes?: string;
	}
) {
	const [row] = await db
		.update(customer)
		.set({
			email: input.email?.trim() ? input.email.trim() : null,
			phone: input.phone?.trim() ? input.phone.trim() : null,
			...(input.smsOptOut === undefined ? {} : { smsOptOut: input.smsOptOut }),
			...(input.emailOptOut === undefined ? {} : { emailOptOut: input.emailOptOut })
		})
		.where(and(eq(customer.id, customerId), eq(customer.portalUserId, userId)))
		.returning();
	if (!row) error(403, 'Not your customer record');
	// Access notes live on the customer's primary service location.
	if (input.accessNotes !== undefined) {
		const [loc] = await db
			.select({ id: serviceLocation.id })
			.from(serviceLocation)
			.where(eq(serviceLocation.customerId, customerId))
			.orderBy(desc(serviceLocation.isPrimary), asc(serviceLocation.label))
			.limit(1);
		if (loc)
			await db
				.update(serviceLocation)
				.set({ accessNotes: input.accessNotes.trim() })
				.where(eq(serviceLocation.id, loc.id));
	}
	return row;
}

/** Customer asks for a different time — lands on the job timeline for staff to act on. */
export async function requestReschedule(
	orgId: string,
	customerId: string,
	jobId: string,
	preferredTime: string
) {
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
	if (!j) error(404, 'Visit not found');
	await db.insert(jobEvent).values({
		organizationId: orgId,
		jobId,
		kind: 'note',
		memberId: null,
		note: `Customer requested a different time — ${preferredTime}`
	});
	await emit({
		orgId,
		actorId: null,
		entityType: 'job',
		entityId: jobId,
		action: 'reschedule_requested',
		summary: `J-${j.number} reschedule requested by customer`
	});
	return { ok: true };
}

/** Customer asks to cancel an upcoming visit — timeline note + staff alert, job stays put. */
export async function requestVisitCancel(
	orgId: string,
	customerId: string,
	jobId: string,
	reason: string
) {
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
	if (!j) error(404, 'Visit not found');
	if (j.startsAt && j.startsAt < new Date()) error(400, 'That visit is already underway');
	const [asked] = await db
		.select({ id: jobEvent.id })
		.from(jobEvent)
		.where(
			and(
				eq(jobEvent.jobId, jobId),
				eq(jobEvent.kind, 'note'),
				like(jobEvent.note, 'Customer requested cancellation%')
			)
		)
		.limit(1);
	if (asked) error(409, 'Cancellation already requested');
	await db.insert(jobEvent).values({
		organizationId: orgId,
		jobId,
		kind: 'note',
		memberId: null,
		note: `Customer requested cancellation${reason ? ` — ${reason}` : ''}`
	});
	await emit({
		orgId,
		actorId: null,
		entityType: 'job',
		entityId: jobId,
		action: 'cancel_requested',
		summary: `J-${j.number} cancellation requested by customer`
	});
	await notifyStaffVisitCancel(orgId, jobId);
	return { ok: true };
}

/** Customer rates a completed visit — 1..5 stars + optional note, once per visit. */
export async function rateVisit(
	orgId: string,
	customerId: string,
	jobId: string,
	rating: number,
	note: string
) {
	const [j] = await db
		.select()
		.from(job)
		.where(
			and(
				eq(job.organizationId, orgId),
				eq(job.id, jobId),
				eq(job.customerId, customerId),
				eq(job.status, 'done'),
				isNull(job.cancelledAt)
			)
		);
	if (!j) error(404, 'Visit not found');
	if (j.rating) error(409, 'Already rated');
	await db
		.update(job)
		.set({ rating, ratingNote: note || null, ratedAt: new Date() })
		.where(eq(job.id, jobId));
	await emit({
		orgId,
		actorId: null,
		entityType: 'job',
		entityId: jobId,
		action: 'rated',
		summary: `J-${j.number} rated ${rating}/5 by the customer${note ? ` — ${note}` : ''}`
	});
	return { ok: true };
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

/** Customer flags an open charge as wrong — staff get an inbox row + email. */
export async function reportChargeProblem(
	orgId: string,
	customerId: string,
	chargeId: string,
	note: string
) {
	const [row] = await db
		.select()
		.from(charge)
		.where(
			and(
				eq(charge.organizationId, orgId),
				eq(charge.id, chargeId),
				eq(charge.customerId, customerId)
			)
		);
	if (!row) error(404, 'Charge not found');
	if (row.status !== 'open') error(409, 'Only unpaid charges can be disputed');
	if (row.disputedAt) error(409, 'Problem already reported on this charge');
	await db
		.update(charge)
		.set({ disputedAt: new Date(), disputeNote: note.trim() || null })
		.where(eq(charge.id, chargeId));
	await emit({
		orgId,
		actorId: null,
		entityType: 'charge',
		entityId: chargeId,
		action: 'dispute_reported',
		summary: `Charge “${row.description || 'charge'}” disputed by customer`
	});
	await notifyChargeDispute(orgId, chargeId);
	return { ok: true };
}
