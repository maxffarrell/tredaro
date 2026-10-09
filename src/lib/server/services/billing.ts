import { createHmac, timingSafeEqual } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { BETTER_AUTH_SECRET } from '$app/env/private';
import { and, asc, desc, eq, getTableColumns, gte, lt, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	agreementPlan,
	charge,
	companySettings,
	customer,
	invoice,
	invoiceItem,
	job,
	jobMaterial,
	jobTimeEntry,
	inventoryItem,
	payment,
	pricebookItem,
	serviceAgreement,
	serviceLocation,
	organization,
	estimateItem,
	jobType,
	outer
} from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import { emit } from './events.ts';
import { getSettings, nextNumber } from './settings.ts';
import { providers } from '#lib/server/payments/index.ts';
import { providerRow } from '#lib/server/payments/settings.ts';
import { appOrigin } from '#lib/server/email.ts';
import { formatMoney, todayISO } from '#lib/format.ts';
import { addDays } from '#lib/tz.ts';
import type * as s from '#lib/schemas.ts';
import type * as v from 'valibot';

// ---------- Agreement plans ----------

export async function listPlans(orgId: string) {
	return db
		.select({
			...getTableColumns(agreementPlan),
			activeCustomers:
				sql<number>`(select count(*) from ${serviceAgreement} a where a.plan_id = ${outer(agreementPlan.id)} and a.status = 'active')`.mapWith(
					Number
				)
		})
		.from(agreementPlan)
		.where(eq(agreementPlan.organizationId, orgId))
		.orderBy(asc(agreementPlan.amount));
}

export async function getPlan(orgId: string, id: string) {
	const [row] = await db
		.select()
		.from(agreementPlan)
		.where(and(eq(agreementPlan.organizationId, orgId), eq(agreementPlan.id, id)));
	if (!row) error(404, 'Agreement plan not found');
	return row;
}

export async function createPlan(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.agreementPlanInput>
) {
	const [row] = await db
		.insert(agreementPlan)
		.values({
			organizationId: ctx.orgId,
			name: input.name,
			description: input.description,
			amount: input.amount,
			interval: input.interval,
			initialFee: input.initialFee,
			includedVisits: input.includedVisits ?? null,
			discountPct: input.discountPct,
			jobTypeId: input.jobTypeId ?? null,
			listed: input.listed,
			active: input.active
		})
		.returning();
	return row;
}

export async function updatePlan(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.agreementPlanUpdate>
) {
	const { id, ...set } = input;
	const [row] = await db
		.update(agreementPlan)
		.set(set)
		.where(and(eq(agreementPlan.organizationId, ctx.orgId), eq(agreementPlan.id, id)))
		.returning();
	if (!row) error(404, 'Agreement plan not found');
	return row;
}

// ---------- Service agreements ----------

/** Adds the interval to a date, on the same calendar day for month/year. */
export function nextPeriod(startISO: string, interval: 'month' | 'year') {
	const d = new Date(`${startISO}T00:00:00Z`);
	if (interval === 'month') d.setUTCMonth(d.getUTCMonth() + 1);
	else d.setUTCFullYear(d.getUTCFullYear() + 1);
	return d.toISOString().slice(0, 10);
}

export async function listAgreements(orgId: string, status?: string[]) {
	return db
		.select({
			agreement: serviceAgreement,
			customerName: customer.name,
			companyName: customer.companyName,
			planName: agreementPlan.name,
			amount: agreementPlan.amount,
			interval: agreementPlan.interval,
			includedVisits: agreementPlan.includedVisits,
			/** Visit jobs generated for the agreement's most recent billed period. */
			visitsUsed:
				sql<number>`(select count(*) from ${job} j where j.service_agreement_id = ${serviceAgreement.id} and j.agreement_period = (select max(j2.agreement_period) from ${job} j2 where j2.service_agreement_id = ${serviceAgreement.id}))`.mapWith(
					Number
				),
			/** Billed recurring periods so far (for fixed-term agreements). */
			periodsBilled:
				sql<number>`(select count(*) from ${charge} ch where ch.agreement_id = ${serviceAgreement.id} and ch.kind = 'agreement')`.mapWith(
					Number
				)
		})
		.from(serviceAgreement)
		.innerJoin(customer, eq(serviceAgreement.customerId, customer.id))
		.innerJoin(agreementPlan, eq(serviceAgreement.planId, agreementPlan.id))
		.where(
			and(
				eq(serviceAgreement.organizationId, orgId),
				status?.length
					? sql`${outer(serviceAgreement.status)} in (${sql.join(
							status.map((x) => sql`${x}`),
							sql`, `
						)})`
					: undefined
			)
		)
		.orderBy(desc(serviceAgreement.createdAt));
}

export async function getAgreement(orgId: string, id: string) {
	const [row] = await db
		.select({ agreement: serviceAgreement, customerName: customer.name, plan: agreementPlan })
		.from(serviceAgreement)
		.innerJoin(customer, eq(serviceAgreement.customerId, customer.id))
		.innerJoin(agreementPlan, eq(serviceAgreement.planId, agreementPlan.id))
		.where(and(eq(serviceAgreement.organizationId, orgId), eq(serviceAgreement.id, id)));
	if (!row) error(404, 'Agreement not found');
	return row;
}

/**
 * Starts a service agreement: posts the initial fee and the first period's charge,
 * and schedules the next recurring charge.
 */
export async function createAgreement(
	ctx: { orgId: string; userId?: string | null },
	input: v.InferOutput<typeof s.agreementInput>
) {
	const [c] = await db
		.select()
		.from(customer)
		.where(and(eq(customer.organizationId, ctx.orgId), eq(customer.id, input.customerId)));
	if (!c) error(404, 'Customer not found');
	const p = await getPlan(ctx.orgId, input.planId);

	const start = input.startsAt ?? todayISO();
	const [row] = await db
		.insert(serviceAgreement)
		.values({
			organizationId: ctx.orgId,
			customerId: input.customerId,
			planId: input.planId,
			startsAt: new Date(`${start}T00:00:00Z`),
			nextChargeAt: new Date(`${nextPeriod(start, p.interval)}T00:00:00Z`),
			maxPeriods: input.maxPeriods ?? null
		})
		.returning();

	if (p.initialFee > 0) {
		await db.insert(charge).values({
			organizationId: ctx.orgId,
			customerId: input.customerId,
			agreementId: row!.id,
			kind: 'initial',
			description: `Setup fee — ${p.name}`,
			dueDate: start,
			amount: p.initialFee
		});
		await applyUnappliedCredit(ctx.orgId, input.customerId);
	}
	if (p.amount > 0) {
		await postAgreementCharge(ctx.orgId, row!.id, start, p);
		await completeIfTermDone(row!);
	}
	await generateAgreementVisits(ctx.orgId, row!, start, p);
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId ?? null,
		entityType: 'agreement',
		entityId: row!.id,
		action: 'created',
		summary: `${c.name} → ${p.name}`
	});
	return row;
}

/** Recurring periods billed so far (kind='agreement' charges carry periodStart). */
async function billedPeriods(agreementId: string, q: typeof db = db): Promise<number> {
	const [{ n }] = await q
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(charge)
		.where(and(eq(charge.agreementId, agreementId), eq(charge.kind, 'agreement')));
	return n;
}

/** Marks an agreement completed once its fixed term is fully billed. */
async function completeIfTermDone(
	m: { id: string; maxPeriods: number | null },
	q: typeof db = db
): Promise<boolean> {
	if (!m.maxPeriods) return false;
	if ((await billedPeriods(m.id, q)) < m.maxPeriods) return false;
	await q
		.update(serviceAgreement)
		.set({ status: 'completed', nextChargeAt: null, cancelledAt: new Date() })
		.where(eq(serviceAgreement.id, m.id));
	return true;
}

/**
 * Posts the recurring charge for one period. Idempotent via the period unique index.
 * Returns the inserted charge, or null when it already existed.
 */
async function postAgreementCharge(
	orgId: string,
	agreementId: string,
	periodStart: string,
	p: { name: string; amount: number },
	q: typeof db = db
) {
	const [row] = await q
		.insert(charge)
		.values({
			organizationId: orgId,
			customerId: (
				await q
					.select({ customerId: serviceAgreement.customerId })
					.from(serviceAgreement)
					.where(eq(serviceAgreement.id, agreementId))
			)[0]!.customerId,
			agreementId,
			kind: 'agreement',
			description: `${p.name} — period starting ${periodStart}`,
			periodStart,
			dueDate: periodStart,
			amount: p.amount
		})
		.onConflictDoNothing()
		.returning();
	if (row) await applyUnappliedCredit(orgId, row.customerId, q);
	return row ?? null;
}

/**
 * Attempts to settle a freshly posted recurring charge against the customer's saved
 * card. On success the payment lands through recordOnlinePayment (which also emails
 * the receipt); on any failure the charge stays open and staff get an inbox row.
 */
async function autoChargeAgreement(
	orgId: string,
	posted: { id: string; customerId: string; amount: number; description: string | null }
) {
	const [c] = await db
		.select({
			savedCardProvider: customer.savedCardProvider,
			savedCardCustomer: customer.savedCardCustomer,
			savedCardRef: customer.savedCardRef,
			savedCardLabel: customer.savedCardLabel,
			email: customer.email
		})
		.from(customer)
		.where(and(eq(customer.organizationId, orgId), eq(customer.id, posted.customerId)));
	if (!c?.savedCardProvider || !c.savedCardCustomer || !c.savedCardRef) return;

	const provider = providers.find((p) => p.id === c.savedCardProvider);
	if (!provider?.chargeSaved) return;
	const row = await providerRow(orgId, provider.id);
	if (!provider.ready(row)) return;

	const [settings] = await db
		.select({ currency: companySettings.currency })
		.from(companySettings)
		.where(eq(companySettings.organizationId, orgId));
	const paymentId = await provider.chargeSaved({
		orgId,
		customerId: posted.customerId,
		email: c.email,
		amount: posted.amount,
		currency: settings?.currency ?? 'usd',
		description: posted.description ?? 'Recurring charge',
		customerRef: c.savedCardCustomer,
		paymentRef: c.savedCardRef,
		row
	});
	if (paymentId) {
		const { recordOnlinePayment } = await import('#lib/server/payments/record.ts');
		await recordOnlinePayment({
			orgId,
			customerId: posted.customerId,
			amount: posted.amount,
			method: provider.id === 'stripe' ? 'stripe' : 'other',
			externalId: paymentId,
			provider: provider.name
		});
		await emit({
			orgId,
			entityType: 'customer',
			entityId: posted.customerId,
			action: 'auto_charged',
			summary: `${formatMoney(posted.amount, settings?.currency ?? 'usd')} auto-charged to ${c.savedCardLabel ?? 'card on file'}`
		});
		return;
	}
	const { notifyAutoChargeFailed, emailAutoChargeFailedToCustomer } =
		await import('./notifications.ts');
	await notifyAutoChargeFailed(orgId, posted.customerId, posted.id, c.savedCardLabel);
	await emailAutoChargeFailedToCustomer(
		orgId,
		posted.customerId,
		posted.id,
		posted.amount,
		c.savedCardLabel
	);
}

/**
 * Staff-initiated "charge card on file" — settles the customer's open charges
 * oldest-first through their saved card. Stops allocating on the first declined
 * charge and reports how much landed.
 */
export async function chargeOpenBalance(ctx: OrgContext, customerId: string) {
	const [c] = await db
		.select()
		.from(customer)
		.where(and(eq(customer.organizationId, ctx.orgId), eq(customer.id, customerId)));
	if (!c) error(404, 'Customer not found');
	if (!c.savedCardProvider || !c.savedCardCustomer || !c.savedCardRef)
		error(409, 'No card on file for this customer');
	const provider = providers.find((p) => p.id === c.savedCardProvider);
	if (!provider?.chargeSaved) error(409, 'This payment provider cannot charge saved cards');
	const row = await providerRow(ctx.orgId, provider.id);
	if (!provider.ready(row)) error(409, `${provider.name} is not available right now`);
	const open = await db
		.select({
			id: charge.id,
			description: charge.description,
			open: sql<number>`${outer(charge.amount)} - coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${outer(charge.id)}), 0)`.mapWith(
				Number
			)
		})
		.from(charge)
		.where(
			and(
				eq(charge.organizationId, ctx.orgId),
				eq(charge.customerId, customerId),
				eq(charge.status, 'open'),
				sql`${charge.amount} > 0`
			)
		)
		.orderBy(asc(charge.dueDate), asc(charge.createdAt));
	if (!open.some((ch) => ch.open > 0)) error(400, 'Nothing to charge — balance is clear');
	const [settings] = await db
		.select({ currency: companySettings.currency })
		.from(companySettings)
		.where(eq(companySettings.organizationId, ctx.orgId));
	const { recordOnlinePayment } = await import('#lib/server/payments/record.ts');
	let charged = 0;
	let failed = 0;
	for (const ch of open) {
		if (ch.open <= 0) continue;
		const paymentId = await provider.chargeSaved({
			orgId: ctx.orgId,
			customerId,
			email: c.email,
			amount: ch.open,
			currency: settings?.currency ?? 'usd',
			description: ch.description || `Charge for ${c.name}`,
			customerRef: c.savedCardCustomer,
			paymentRef: c.savedCardRef,
			row
		});
		if (!paymentId) {
			failed += ch.open;
			continue;
		}
		await recordOnlinePayment({
			orgId: ctx.orgId,
			customerId,
			amount: ch.open,
			method: provider.id === 'stripe' ? 'stripe' : 'other',
			externalId: paymentId,
			provider: provider.name,
			chargeIds: [ch.id]
		});
		charged += ch.open;
	}
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId ?? null,
		entityType: 'customer',
		entityId: customerId,
		action: 'card_charged',
		summary: `${formatMoney(charged, settings?.currency ?? 'usd')} charged to ${c.savedCardLabel ?? 'card on file'}${failed ? ` (${formatMoney(failed, settings?.currency ?? 'usd')} declined)` : ''}`
	});
	return { charged, failed };
}

export async function updateAgreement(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.agreementUpdate>
) {
	const [existing] = await db
		.select({ agreement: serviceAgreement, interval: agreementPlan.interval })
		.from(serviceAgreement)
		.innerJoin(agreementPlan, eq(serviceAgreement.planId, agreementPlan.id))
		.where(and(eq(serviceAgreement.organizationId, ctx.orgId), eq(serviceAgreement.id, input.id)));
	if (!existing) error(404, 'Agreement not found');
	const [row] = await db
		.update(serviceAgreement)
		.set({
			status: input.status,
			cancelledAt: input.status === 'cancelled' ? new Date() : null,
			nextChargeAt:
				input.status === 'active'
					? new Date(
							`${nextPeriod(new Date().toISOString().slice(0, 10), existing.interval)}T00:00:00Z`
						)
					: null
		})
		.where(and(eq(serviceAgreement.organizationId, ctx.orgId), eq(serviceAgreement.id, input.id)))
		.returning();
	if (!row) error(404, 'Agreement not found');
	return row;
}

/**
 * Charges the upcoming agreement period early: posts the period's charge
 * (idempotent via the agreement+period unique index), rolls `nextChargeAt`
 * forward one interval, and generates that period's included visits.
 */
export async function chargeAgreementNow(ctx: OrgContext, id: string) {
	const [row] = await db
		.select({ agreement: serviceAgreement, plan: agreementPlan })
		.from(serviceAgreement)
		.innerJoin(agreementPlan, eq(serviceAgreement.planId, agreementPlan.id))
		.where(and(eq(serviceAgreement.organizationId, ctx.orgId), eq(serviceAgreement.id, id)));
	if (!row) error(404, 'Agreement not found');
	const { agreement: m, plan: p } = row;
	if (m.status !== 'active') error(409, `Agreement is ${m.status}`);
	if (!m.nextChargeAt) error(409, 'Agreement has no upcoming charge');
	if (m.maxPeriods && (await billedPeriods(m.id)) >= m.maxPeriods) {
		await completeIfTermDone(m);
		error(409, 'Agreement term is fully billed');
	}

	const period = m.nextChargeAt.toISOString().slice(0, 10);
	const next = nextPeriod(period, p.interval);
	let postedCharge: {
		id: string;
		customerId: string;
		amount: number;
		description: string | null;
	} | null = null;
	// Charge + roll-forward + visit generation commit together — a failure
	// anywhere leaves the agreement untouched so the button stays truthful.
	await db.transaction(async (tx) => {
		if (p.amount > 0)
			postedCharge = await postAgreementCharge(
				ctx.orgId,
				m.id,
				period,
				p,
				tx as unknown as typeof db
			);
		const done = await completeIfTermDone(m, tx as unknown as typeof db);
		if (!done)
			await tx
				.update(serviceAgreement)
				.set({ nextChargeAt: new Date(`${next}T00:00:00Z`) })
				.where(eq(serviceAgreement.id, m.id));
		await generateAgreementVisits(ctx.orgId, m, period, p, tx as unknown as typeof db);
	});
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'service_agreement',
		entityId: m.id,
		action: 'charged_early',
		summary: `${p.name} charged early for period ${period}`
	});
	// Auto-charge after the transaction commits — the provider call must not
	// hold the tx open, and an already-posted charge skips itself anyway.
	if (postedCharge) await autoChargeAgreement(ctx.orgId, postedCharge);
	return { period };
}

/**
 * Creates a plan's included visits for one billed period as unscheduled jobs
 * (`source: 'agreement'`), ready for a dispatcher to assign. Idempotent via the
 * (serviceAgreementId, agreementPeriod, agreementVisitNo) unique index.
 */
async function generateAgreementVisits(
	orgId: string,
	agreement: typeof serviceAgreement.$inferSelect,
	periodStart: string,
	p: typeof agreementPlan.$inferSelect,
	q: typeof db = db
) {
	const visits = p.includedVisits ?? 0;
	if (visits <= 0) return 0;
	const jt = p.jobTypeId
		? (
				await q
					.select()
					.from(jobType)
					.where(and(eq(jobType.organizationId, orgId), eq(jobType.id, p.jobTypeId)))
			)[0]
		: null;
	const [loc] = await q
		.select()
		.from(serviceLocation)
		.where(
			and(eq(serviceLocation.customerId, agreement.customerId), eq(serviceLocation.isPrimary, true))
		);
	let created = 0;
	for (let i = 1; i <= visits; i++) {
		const [row] = await q
			.insert(job)
			.values({
				organizationId: orgId,
				number: await nextNumber(orgId, 'job', q),
				jobTypeId: jt?.id ?? null,
				customerId: agreement.customerId,
				serviceLocationId: loc?.id ?? null,
				officeId: jt?.officeId ?? null,
				technicianId: jt?.technicianId ?? null,
				summary: `${p.name} visit${visits > 1 ? ` ${i} of ${visits}` : ''}`,
				status: 'unscheduled',
				source: 'agreement',
				serviceAgreementId: agreement.id,
				agreementPeriod: periodStart,
				agreementVisitNo: i
			})
			.onConflictDoNothing({
				target: [job.serviceAgreementId, job.agreementPeriod, job.agreementVisitNo]
			})
			.returning({ id: job.id });
		if (row) created++;
	}
	if (created)
		await emit({
			orgId,
			entityType: 'service_agreement',
			entityId: agreement.id,
			action: 'visits_created',
			summary: `${created} ${p.name} visit${created === 1 ? '' : 's'} added to the unscheduled queue`
		});
	return created;
}

/**
 * Posts agreement charges that have come due, rolls `nextChargeAt` forward and
 * generates the current period's included visits. Runs from /api/cron and
 * opportunistically when staff open the app.
 */
export async function runBilling(orgId: string) {
	const now = new Date();
	const due = await db
		.select({ agreement: serviceAgreement, plan: agreementPlan })
		.from(serviceAgreement)
		.innerJoin(agreementPlan, eq(serviceAgreement.planId, agreementPlan.id))
		.where(
			and(
				eq(serviceAgreement.organizationId, orgId),
				eq(serviceAgreement.status, 'active'),
				lt(serviceAgreement.nextChargeAt, now)
			)
		);
	let posted = 0;
	for (const { agreement: m, plan: p } of due) {
		if (!m.nextChargeAt) continue;
		let period = m.nextChargeAt.toISOString().slice(0, 10);
		let lastPosted: string | null = null;
		// Catch up on any missed periods (install was offline).
		let termDone = false;
		while (new Date(`${period}T00:00:00Z`) < now) {
			if (p.amount > 0) {
				const postedCharge = await postAgreementCharge(orgId, m.id, period, p);
				if (postedCharge) await autoChargeAgreement(orgId, postedCharge);
			}
			lastPosted = period;
			posted++;
			if (await completeIfTermDone(m)) {
				termDone = true;
				break;
			}
			period = nextPeriod(period, p.interval);
		}
		if (!termDone)
			await db
				.update(serviceAgreement)
				.set({ nextChargeAt: new Date(`${period}T00:00:00Z`) })
				.where(eq(serviceAgreement.id, m.id));
		// The last posted period is the current one — that is the only period whose
		// visits should appear on the dispatch board now.
		if (lastPosted) await generateAgreementVisits(orgId, m, lastPosted, p);
	}
	return posted;
}

// ---------- Pricebook ----------

export async function listPricebook(orgId: string, q?: string) {
	const term = q?.trim();
	return db
		.select()
		.from(pricebookItem)
		.where(
			and(
				eq(pricebookItem.organizationId, orgId),
				term
					? sql`(${pricebookItem.name} ilike ${`%${term}%`} or ${pricebookItem.category} ilike ${`%${term}%`})`
					: undefined
			)
		)
		.orderBy(asc(pricebookItem.category), asc(pricebookItem.name));
}

export async function createPricebookItem(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.pricebookItemInput>
) {
	const [row] = await db
		.insert(pricebookItem)
		.values({
			organizationId: ctx.orgId,
			kind: input.kind,
			category: input.category,
			name: input.name,
			description: input.description,
			price: input.price,
			durationMin: input.durationMin ?? null,
			jobTypeId: input.jobTypeId ?? null,
			active: input.active
		})
		.returning();
	return row;
}

export async function importPricebookItems(
	ctx: OrgContext,
	rows: v.InferOutput<typeof s.pricebookImportInput>
) {
	const taken = new Set(
		(
			await db
				.select({ name: sql<string>`lower(${pricebookItem.name})` })
				.from(pricebookItem)
				.where(eq(pricebookItem.organizationId, ctx.orgId))
		).map((r) => r.name)
	);
	const seen = new Set<string>();
	const toInsert = rows.filter((r) => {
		const n = r.name.toLowerCase();
		if (taken.has(n) || seen.has(n)) return false;
		seen.add(n);
		return true;
	});
	if (toInsert.length)
		await db.insert(pricebookItem).values(
			toInsert.map((r) => ({
				organizationId: ctx.orgId,
				kind: r.kind,
				category: r.category,
				name: r.name,
				description: r.description,
				price: Math.round(r.price * 100),
				durationMin: r.durationMin ?? null,
				active: true
			}))
		);
	return { created: toInsert.length, skipped: rows.length - toInsert.length };
}

export async function updatePricebookItem(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.pricebookItemUpdate>
) {
	const { id, ...set } = input;
	const [row] = await db
		.update(pricebookItem)
		.set({ ...set, durationMin: set.durationMin })
		.where(and(eq(pricebookItem.organizationId, ctx.orgId), eq(pricebookItem.id, id)))
		.returning();
	if (!row) error(404, 'Pricebook item not found');
	return row;
}

export async function adjustPricebookPrices(
	ctx: OrgContext,
	input: { pct: number; category?: string }
) {
	const cat = input.category?.trim();
	const res = await db
		.update(pricebookItem)
		.set({
			price: sql<number>`round(${pricebookItem.price} * (1 + ${input.pct}::float / 100))::int`
		})
		.where(
			and(
				eq(pricebookItem.organizationId, ctx.orgId),
				eq(pricebookItem.active, true),
				cat ? eq(pricebookItem.category, cat) : undefined
			)
		)
		.returning({ id: pricebookItem.id });
	return { adjusted: res.length };
}

// ---------- Invoices ----------

type LineItems = v.InferOutput<typeof s.invoiceInput>['items'];

const lineTotal = (items: LineItems) => items.reduce((sum, i) => sum + i.qty * i.unitPrice, 0);

export async function listInvoices(orgId: string, status?: string) {
	return db
		.select({
			invoice,
			customerName: customer.name,
			companyName: customer.companyName,
			jobNumber: job.number,
			total:
				sql<number>`coalesce((select sum(i.qty * i.unit_price) from ${invoiceItem} i where i.invoice_id = ${outer(invoice.id)}), 0)`.mapWith(
					Number
				),
			paid: sql<number>`coalesce((select sum(p.amount) from ${payment} p join ${charge} c on c.id = p.charge_id where c.invoice_id = ${outer(invoice.id)}), 0)`.mapWith(
				Number
			)
		})
		.from(invoice)
		.innerJoin(customer, eq(invoice.customerId, customer.id))
		.leftJoin(job, eq(invoice.jobId, job.id))
		.where(
			and(
				eq(invoice.organizationId, orgId),
				status === 'overdue'
					? sql`${invoice.status} = 'open' and exists (
						select 1 from ${charge} c
						where c.invoice_id = ${invoice.id}
							and c.status = 'open'
							and c.due_date < current_date
							and coalesce((select sum(p.amount) from ${payment} p where p.charge_id = c.id), 0) < c.amount
					)`
					: status
						? eq(invoice.status, status as never)
						: undefined
			)
		)
		.orderBy(desc(invoice.number));
}

export async function getInvoice(orgId: string, id: string) {
	const [row] = await db
		.select({ invoice, customer, jobNumber: job.number })
		.from(invoice)
		.innerJoin(customer, eq(invoice.customerId, customer.id))
		.leftJoin(job, eq(invoice.jobId, job.id))
		.where(and(eq(invoice.organizationId, orgId), eq(invoice.id, id)));
	if (!row) error(404, 'Invoice not found');
	const items = await db
		.select()
		.from(invoiceItem)
		.where(eq(invoiceItem.invoiceId, id))
		.orderBy(asc(invoiceItem.position));
	const charges = await db
		.select({
			charge,
			paid: sql<number>`coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${outer(charge.id)}), 0)`.mapWith(
				Number
			)
		})
		.from(charge)
		.where(eq(charge.invoiceId, id));
	return { ...row, items, charges };
}

/**
 * Issues an invoice: stores the line items and posts one receivable for the total.
 * `items` defaults to the job's approved estimate items when `fromEstimate` is set.
 */
/** Highest member discount % across the customer's active agreements (0 = none). */
async function activeDiscountPct(orgId: string, customerId: string) {
	const [row] = await db
		.select({ pct: sql<number>`coalesce(max(${agreementPlan.discountPct}), 0)`.mapWith(Number) })
		.from(serviceAgreement)
		.innerJoin(agreementPlan, eq(serviceAgreement.planId, agreementPlan.id))
		.where(
			and(
				eq(serviceAgreement.organizationId, orgId),
				eq(serviceAgreement.customerId, customerId),
				eq(serviceAgreement.status, 'active')
			)
		);
	return row?.pct ?? 0;
}

export async function createInvoice(
	ctx: { orgId: string; userId?: string | null },
	input: v.InferOutput<typeof s.invoiceInput>
) {
	const [c] = await db
		.select()
		.from(customer)
		.where(and(eq(customer.organizationId, ctx.orgId), eq(customer.id, input.customerId)));
	if (!c) error(404, 'Customer not found');
	if (input.jobId) {
		const [j] = await db
			.select({ id: job.id })
			.from(job)
			.where(and(eq(job.organizationId, ctx.orgId), eq(job.id, input.jobId)));
		if (!j) error(404, 'Job not found');
	}

	const number = await nextNumber(ctx.orgId, 'invoice');
	const settings = await getSettings(ctx.orgId);
	const items = [...input.items];
	// Membership perk: customers under an active agreement get the plan's % off work.
	// Applied as a negative line BEFORE tax so tax is on the discounted amount.
	const discountPct = await activeDiscountPct(ctx.orgId, input.customerId);
	if (discountPct > 0) {
		const off = Math.round((lineTotal(items) * discountPct) / 100);
		if (off > 0)
			items.push({
				pricebookItemId: null,
				name: `Membership discount (${discountPct}%)`,
				description: '',
				qty: 1,
				unitPrice: -off
			});
	}
	if (settings.taxRateBps > 0 && !c.taxExempt) {
		const tax = Math.round((lineTotal(items) * settings.taxRateBps) / 10000);
		if (tax > 0)
			items.push({
				pricebookItemId: null,
				name: `Sales tax (${settings.taxRateBps / 100}%)`,
				description: '',
				qty: 1,
				unitPrice: tax
			});
	}
	const total = lineTotal(items);
	const inv = await db.transaction(async (tx) => {
		const [row] = await tx
			.insert(invoice)
			.values({
				organizationId: ctx.orgId,
				number,
				customerId: input.customerId,
				jobId: input.jobId ?? null,
				dueDate: input.dueDate,
				notes: input.notes
			})
			.returning();
		await tx.insert(invoiceItem).values(
			items.map((it, i) => ({
				invoiceId: row!.id,
				pricebookItemId: it.pricebookItemId ?? null,
				name: it.name,
				description: it.description,
				qty: it.qty,
				unitPrice: it.unitPrice,
				position: i
			}))
		);
		if (total > 0) {
			await tx.insert(charge).values({
				organizationId: ctx.orgId,
				customerId: input.customerId,
				jobId: input.jobId ?? null,
				invoiceId: row!.id,
				kind: 'job',
				description: `Invoice #${number}`,
				dueDate: input.dueDate,
				amount: total
			});
			await applyUnappliedCredit(ctx.orgId, input.customerId, tx);
		}
		return row!;
	});
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'invoice',
		entityId: inv.id,
		action: 'issued',
		summary: `Invoice #${number} for ${c.name} — ${formatMoney(total)}`
	});
	return inv;
}

/** Voids an invoice and its outstanding receivable. */
export async function updateInvoice(ctx: OrgContext, input: v.InferOutput<typeof s.invoiceUpdate>) {
	const [existing] = await db
		.select()
		.from(invoice)
		.where(and(eq(invoice.organizationId, ctx.orgId), eq(invoice.id, input.id)));
	if (!existing) error(404, 'Invoice not found');
	const [row] = await db
		.update(invoice)
		.set({ status: input.status, dueDate: input.dueDate, notes: input.notes })
		.where(eq(invoice.id, input.id))
		.returning();
	if (input.status === 'void') {
		await db
			.update(charge)
			.set({ status: 'void' })
			.where(
				and(
					eq(charge.invoiceId, input.id),
					eq(charge.status, 'open'),
					sql`(select coalesce(sum(p.amount),0) from ${payment} p where p.charge_id = ${charge.id}) = 0`
				)
			);
	}
	return row;
}

// ---------- Public invoice link ----------

function signInvoice(payload: string) {
	return createHmac('sha256', BETTER_AUTH_SECRET).update(`invoice:${payload}`).digest('base64url');
}

/** Stateless signed link to the public invoice page (`/i/<id>.<sig>`). */
export function invoiceToken(invoiceId: string) {
	return `${invoiceId}.${signInvoice(invoiceId)}`;
}

export function verifyInvoiceToken(token: string) {
	const m = /^([0-9a-f-]{36})\.([\w-]+)$/.exec(token.trim());
	if (!m) return null;
	const [, invoiceId, sig] = m;
	const expected = Buffer.from(signInvoice(invoiceId!));
	const got = Buffer.from(sig!);
	return expected.length === got.length && timingSafeEqual(expected, got) ? invoiceId : null;
}

export function invoiceUrl(id: string) {
	return `${appOrigin()}/i/${invoiceToken(id)}`;
}

/** What the public /i/[token] page shows. */
export async function publicInvoice(id: string) {
	const [row] = await db
		.select({ invoice, customerName: customer.name, orgName: organization.name })
		.from(invoice)
		.innerJoin(customer, eq(invoice.customerId, customer.id))
		.innerJoin(organization, eq(organization.id, invoice.organizationId))
		.where(eq(invoice.id, id));
	if (!row) error(404, 'Invoice not found');
	const [items, [{ paid = 0 } = {}], [settings]] = await Promise.all([
		db
			.select()
			.from(invoiceItem)
			.where(eq(invoiceItem.invoiceId, id))
			.orderBy(asc(invoiceItem.position)),
		db
			.select({ paid: sql<number>`coalesce(sum(${payment.amount}), 0)`.mapWith(Number) })
			.from(payment)
			.innerJoin(charge, eq(charge.id, payment.chargeId))
			.where(eq(charge.invoiceId, id)),
		db
			.select({ currency: companySettings.currency })
			.from(companySettings)
			.where(eq(companySettings.organizationId, row.invoice.organizationId))
	]);
	const total = items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
	// Same availability rule as the portal's pay button.
	const providers_ = [];
	for (const p of providers) {
		if (!p.configured() || !p.supportsCurrency(settings?.currency ?? 'usd')) continue;
		const prow = await providerRow(row.invoice.organizationId, p.id);
		if (p.ready(prow))
			providers_.push({ id: p.id, name: p.name, payLabel: p.payLabel, newTab: p.newTab });
	}
	return {
		...row,
		items,
		total,
		paid,
		currency: settings?.currency ?? 'usd',
		providers: providers_
	};
}

/**
 * Starts a provider checkout for the invoice's remaining balance, straight off the
 * public link — no portal login needed. Success/cancel return to the same link.
 */
export async function publicInvoiceCheckout(token: string, providerId: string) {
	const id = verifyInvoiceToken(token);
	if (!id) error(400, 'Invalid link');
	const inv = await publicInvoice(id);
	if (inv.invoice.status !== 'open') error(409, 'Invoice is no longer payable');
	const balance = inv.total - inv.paid;
	if (balance <= 0) error(400, 'Nothing to pay');
	const provider = providers.find((p) => p.id === providerId);
	if (!provider?.configured()) error(404, 'Unknown provider');
	const row = await providerRow(inv.invoice.organizationId, providerId);
	if (!provider.ready(row)) error(400, `${provider.name} is not available right now`);
	return provider.checkout({
		orgId: inv.invoice.organizationId,
		customerId: inv.invoice.customerId,
		email: null, // the payer types their email at checkout
		amount: balance,
		currency: inv.currency,
		description: `Invoice INV-${inv.invoice.number} — ${inv.orgName}`,
		row,
		paths: { success: `/i/${token}?paid=1`, cancel: `/i/${token}` }
	});
}

/** Prefills an invoice form from a job: approved estimate items when linked, else the job-type flat rate. */
export async function invoicePrefill(orgId: string, jobId: string) {
	const [j] = await db
		.select()
		.from(job)
		.where(and(eq(job.organizationId, orgId), eq(job.id, jobId)));
	if (!j) error(404, 'Job not found');
	if (j.estimateId) {
		const items = await db
			.select()
			.from(estimateItem)
			.where(eq(estimateItem.estimateId, j.estimateId))
			.orderBy(asc(estimateItem.position));
		if (items.length) {
			return {
				job: j,
				items: items.map((i) => ({
					pricebookItemId: i.pricebookItemId,
					name: i.name,
					description: i.description,
					qty: i.qty,
					unitPrice: i.unitPrice
				}))
			};
		}
	}
	const [jt] = j.jobTypeId
		? await db.select().from(jobType).where(eq(jobType.id, j.jobTypeId))
		: [];
	// Materials logged on the job become billable lines at their recorded sell price.
	const mats = await db
		.select({
			name: inventoryItem.name,
			qty: jobMaterial.qty,
			unitPrice: jobMaterial.unitPrice
		})
		.from(jobMaterial)
		.innerJoin(inventoryItem, eq(jobMaterial.inventoryItemId, inventoryItem.id))
		.where(eq(jobMaterial.jobId, jobId));
	// Completed time entries become a Labor line when the job type bills hourly.
	let labor: {
		pricebookItemId: null;
		name: string;
		description: string;
		qty: number;
		unitPrice: number;
	}[] = [];
	if (jt?.hourlyRate) {
		const settings = await getSettings(orgId);
		const [{ minutes }] = await db
			.select({
				minutes:
					sql<number>`coalesce(sum(extract(epoch from (${jobTimeEntry.endedAt} - ${jobTimeEntry.startedAt})) / 60), 0)`.mapWith(
						Number
					)
			})
			.from(jobTimeEntry)
			.where(and(eq(jobTimeEntry.jobId, jobId), sql`${jobTimeEntry.endedAt} is not null`));
		const roundTo = settings.laborRoundingMin || 0;
		const billed = roundTo > 0 ? Math.ceil(minutes / roundTo) * roundTo : minutes;
		const hours = Math.round((billed / 60) * 100) / 100;
		if (hours > 0)
			labor = [
				{
					pricebookItemId: null,
					name: 'Labor',
					description:
						roundTo > 0 && billed !== minutes
							? `${Math.round(minutes)} min on site, billed in ${roundTo}-min increments`
							: '',
					qty: hours,
					unitPrice: jt.hourlyRate
				}
			];
	}
	return {
		job: j,
		items: [
			{
				pricebookItemId: null,
				name: jt?.name || j.summary || 'Service',
				description: j.description,
				qty: 1,
				unitPrice: jt?.defaultAmount ?? 0
			},
			...mats.map((m) => ({
				pricebookItemId: null,
				name: m.name,
				description: '',
				qty: m.qty,
				unitPrice: m.unitPrice
			})),
			...labor
		]
	};
}

// ---------- Charges & payments ----------

export async function listCharges(orgId: string, status?: string) {
	return db
		.select({
			charge,
			customerName: customer.name,
			companyName: customer.companyName,
			invoiceNumber: invoice.number,
			paid: sql<number>`coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${outer(charge.id)}), 0)`.mapWith(
				Number
			)
		})
		.from(charge)
		.innerJoin(customer, eq(charge.customerId, customer.id))
		.leftJoin(invoice, eq(charge.invoiceId, invoice.id))
		.where(
			and(eq(charge.organizationId, orgId), status ? eq(charge.status, status as never) : undefined)
		)
		.orderBy(desc(charge.dueDate));
}

export async function addCharge(ctx: OrgContext, input: v.InferOutput<typeof s.chargeInput>) {
	const row = await db.transaction(async (tx) => {
		const [r] = await tx
			.insert(charge)
			.values({
				organizationId: ctx.orgId,
				customerId: input.customerId,
				jobId: input.jobId ?? null,
				kind: input.kind,
				description: input.description ?? null,
				amount: input.amount,
				dueDate: input.dueDate
			})
			.returning();
		await applyUnappliedCredit(ctx.orgId, input.customerId, tx);
		return r!;
	});
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId ?? null,
		entityType: 'charge',
		entityId: row!.id,
		action: 'created',
		summary: `Charge of ${formatMoney(input.amount)} added`
	});
	return row;
}

/** Adds a negative open charge — credit on file that lowers the customer's open balance. */
export async function addCredit(
	ctx: OrgContext,
	input: { customerId: string; amount: number; note?: string }
) {
	const [c] = await db
		.select()
		.from(customer)
		.where(and(eq(customer.organizationId, ctx.orgId), eq(customer.id, input.customerId)));
	if (!c) error(404, 'Customer not found');
	const [row] = await db
		.insert(charge)
		.values({
			organizationId: ctx.orgId,
			customerId: input.customerId,
			kind: 'other',
			description: `Account credit${input.note ? ` — ${input.note}` : ''}`,
			amount: -Math.abs(input.amount),
			dueDate: new Date().toISOString().slice(0, 10)
		})
		.returning();
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId ?? null,
		entityType: 'charge',
		entityId: row!.id,
		action: 'created',
		summary: `Credit of ${formatMoney(input.amount)} added`
	});
	return row;
}

export async function updateCharge(ctx: OrgContext, input: v.InferOutput<typeof s.chargeUpdate>) {
	const { id, ...set } = input;
	const [row] = await db
		.update(charge)
		.set(set)
		.where(and(eq(charge.organizationId, ctx.orgId), eq(charge.id, id)))
		.returning();
	if (!row) error(404, 'Charge not found');
	return row;
}

/** Records a payment and applies it to the customer's open charges oldest-first. */
/**
 * Moves the customer's unapplied credit (payment rows with charge_id null) onto their
 * open charges, oldest first. Never mutates the original payment: each allocation is a
 * matching pair — a positive row against the charge plus a negative unapplied row — so
 * the unapplied pool shrinks while the received-money ledger stays intact.
 * Runs inside the transaction that created the charge when `q` is a tx handle.
 */
/** Duck-typed db handle so callers can pass a live transaction. */
type DbOrTx = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

export async function applyUnappliedCredit(orgId: string, customerId: string, q: DbOrTx = db) {
	const credits = await q
		.select()
		.from(payment)
		.where(
			and(
				eq(payment.customerId, customerId),
				eq(payment.organizationId, orgId),
				sql`${payment.chargeId} is null`,
				sql`${payment.amount} > 0`,
				sql`${payment.refundedAt} is null`
			)
		)
		.orderBy(asc(payment.paidAt), asc(payment.createdAt));
	if (!credits.length) return;
	const open = await q
		.select({
			id: charge.id,
			description: charge.description,
			open: sql<number>`${outer(charge.amount)} - coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${outer(charge.id)}), 0)`.mapWith(
				Number
			)
		})
		.from(charge)
		.where(
			and(
				eq(charge.organizationId, orgId),
				eq(charge.customerId, customerId),
				eq(charge.status, 'open'),
				sql`${charge.amount} > 0`
			)
		)
		.orderBy(asc(charge.dueDate), asc(charge.createdAt));
	let applied = 0;
	for (const credit of credits) {
		let pool = credit.amount;
		for (const ch of open) {
			if (pool <= 0) break;
			if (ch.open <= 0) continue;
			const take = Math.min(ch.open, pool);
			const now = new Date();
			await q.insert(payment).values([
				{
					organizationId: orgId,
					customerId,
					chargeId: ch.id,
					amount: take,
					method: credit.method,
					reference: credit.reference,
					notes: `Credit applied to ${ch.description || 'charge'}`,
					recordedBy: credit.recordedBy,
					paidAt: credit.paidAt
				},
				{
					organizationId: orgId,
					customerId,
					chargeId: null,
					amount: -take,
					method: credit.method,
					reference: `applied:${credit.id}`,
					notes: `Credit applied to ${ch.description || 'charge'}`,
					recordedBy: credit.recordedBy,
					paidAt: now
				}
			]);
			ch.open -= take;
			pool -= take;
			applied += take;
		}
		if (pool <= 0) continue;
	}
	if (!applied) return;
	await q.execute(sql`
		update ${charge} c set status = 'paid', updated_at = now()
		where c.organization_id = ${orgId} and c.status = 'open' and c.amount > 0
		  and (select coalesce(sum(p.amount), 0) from ${payment} p where p.charge_id = c.id) >= c.amount
	`);
}

export async function recordPayment(ctx: OrgContext, input: v.InferOutput<typeof s.paymentInput>) {
	const [c] = await db
		.select()
		.from(customer)
		.where(and(eq(customer.organizationId, ctx.orgId), eq(customer.id, input.customerId)));
	if (!c) error(404, 'Customer not found');

	let remaining = input.amount;
	const rows = await db.transaction(async (tx) => {
		const out = [];
		if (input.chargeId) {
			const [row] = await tx
				.insert(payment)
				.values({
					organizationId: ctx.orgId,
					customerId: input.customerId,
					chargeId: input.chargeId,
					amount: input.amount,
					method: input.method,
					reference: input.reference ?? null,
					notes: input.notes ?? null,
					recordedBy: ctx.userId
				})
				.returning();
			out.push(row!);
			remaining = 0;
		} else {
			const open = await tx
				.select({
					id: charge.id,
					open: sql<number>`${outer(charge.amount)} - coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${outer(charge.id)}), 0)`.mapWith(
						Number
					)
				})
				.from(charge)
				.where(and(eq(charge.customerId, input.customerId), eq(charge.status, 'open')))
				.orderBy(asc(charge.dueDate), asc(charge.createdAt));
			for (const ch of open) {
				if (remaining <= 0) break;
				if (ch.open <= 0) continue;
				const take = Math.min(ch.open, remaining);
				const [row] = await tx
					.insert(payment)
					.values({
						organizationId: ctx.orgId,
						customerId: input.customerId,
						chargeId: ch.id,
						amount: take,
						method: input.method,
						reference: input.reference ?? null,
						notes: input.notes ?? null,
						recordedBy: ctx.userId
					})
					.returning();
				out.push(row!);
				remaining -= take;
			}
		}
		if (remaining > 0) {
			const [row] = await tx
				.insert(payment)
				.values({
					organizationId: ctx.orgId,
					customerId: input.customerId,
					chargeId: null,
					amount: remaining,
					method: input.method,
					reference: input.reference ?? null,
					notes: input.notes ?? null,
					recordedBy: ctx.userId
				})
				.returning();
			out.push(row!);
		}
		// Mark fully-covered charges paid (credits have negative amounts and never flip).
		await tx.execute(sql`
			update ${charge} c set status = 'paid', updated_at = now()
			where c.organization_id = ${ctx.orgId} and c.status = 'open' and c.amount > 0
			  and (select coalesce(sum(p.amount), 0) from ${payment} p where p.charge_id = c.id) >= c.amount
		`);
		return out;
	});
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId ?? null,
		entityType: 'payment',
		entityId: rows[0]!.id,
		action: 'recorded',
		summary: `${formatMoney(input.amount)} from ${c.name}`,
		data: { customerId: input.customerId, method: input.method }
	});
	return rows;
}

/** Refund a recorded payment: flags it and inserts a negative payment against the same charge, reopening any paid charge it uncovers. */
export async function refundPayment(ctx: OrgContext, paymentId: string) {
	const [p] = await db
		.select()
		.from(payment)
		.where(and(eq(payment.organizationId, ctx.orgId), eq(payment.id, paymentId)));
	if (!p) error(404, 'Payment not found');
	if (p.amount <= 0) error(409, 'Already a refund entry');
	if (p.refundedAt) error(409, 'Payment already refunded');
	const [c] = await db
		.select({ name: customer.name })
		.from(customer)
		.where(eq(customer.id, p.customerId));
	await db.transaction(async (tx) => {
		await tx.update(payment).set({ refundedAt: new Date() }).where(eq(payment.id, p.id));
		await tx.insert(payment).values({
			organizationId: ctx.orgId,
			customerId: p.customerId,
			chargeId: p.chargeId,
			amount: -p.amount,
			method: p.method,
			reference: `refund:${p.id}`,
			notes: `Refund of ${formatMoney(p.amount)} payment${p.externalId ? ' — refund it in the payment provider too' : ''}`,
			recordedBy: ctx.userId
		});
		// Reopen charges this refund uncovered.
		await tx.execute(sql`
			update ${charge} c set status = 'open', updated_at = now()
			where c.organization_id = ${ctx.orgId} and c.status = 'paid'
			  and (select coalesce(sum(p.amount), 0) from ${payment} p where p.charge_id = c.id) < c.amount
		`);
	});
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId ?? null,
		entityType: 'payment',
		entityId: p.id,
		action: 'refunded',
		summary: `${formatMoney(p.amount)} refunded to ${c?.name ?? 'customer'}`,
		data: { customerId: p.customerId, method: p.method }
	});
	return true;
}

export async function listPayments(orgId: string) {
	return db
		.select({ payment, customerName: customer.name })
		.from(payment)
		.innerJoin(customer, eq(payment.customerId, customer.id))
		.where(eq(payment.organizationId, orgId))
		.orderBy(desc(payment.paidAt))
		.limit(200);
}

/** Open balance in minor units (positive = owed). */
export async function customerBalance(orgId: string, customerId: string) {
	const [row] = await db
		.select({
			balance:
				sql<number>`coalesce(sum(case when ${outer(charge.status)} = 'open' then ${outer(charge.amount)} - coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${outer(charge.id)}), 0) else 0 end), 0) - coalesce((select sum(p2.amount) from ${payment} p2 where p2.customer_id = ${customerId} and p2.charge_id is null), 0)`.mapWith(
					Number
				)
		})
		.from(charge)
		.where(and(eq(charge.organizationId, orgId), eq(charge.customerId, customerId)));
	return row?.balance ?? 0;
}

/** Monthly recurring revenue in minor units (normalized to a 30-day month). */
export async function monthlyRecurring(orgId: string) {
	const [row] = await db
		.select({
			mrr: sql<number>`coalesce(sum(case ${outer(agreementPlan.interval)} when 'month' then ${outer(agreementPlan.amount)} when 'year' then ${outer(agreementPlan.amount)} / 12 end), 0)`.mapWith(
				Number
			)
		})
		.from(serviceAgreement)
		.innerJoin(agreementPlan, eq(serviceAgreement.planId, agreementPlan.id))
		.where(and(eq(serviceAgreement.organizationId, orgId), eq(serviceAgreement.status, 'active')));
	return Math.round(row?.mrr ?? 0);
}

export async function getCurrency(orgId: string) {
	const [row] = await db
		.select({ currency: companySettings.currency })
		.from(companySettings)
		.where(eq(companySettings.organizationId, orgId));
	return row?.currency ?? 'usd';
}

/** Recent payments for the billing page, scoped to a window. */
export async function paymentsBetween(orgId: string, from: Date, to: Date) {
	return db
		.select({ payment, customerName: customer.name })
		.from(payment)
		.innerJoin(customer, eq(payment.customerId, customer.id))
		.where(
			and(eq(payment.organizationId, orgId), gte(payment.paidAt, from), lt(payment.paidAt, to))
		)
		.orderBy(desc(payment.paidAt));
}

export { addDays };
