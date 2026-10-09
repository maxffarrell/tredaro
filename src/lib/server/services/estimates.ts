import { createHmac, timingSafeEqual } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { and, asc, count, desc, eq, lt, sql } from 'drizzle-orm';
import { BETTER_AUTH_SECRET } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import {
	activity,
	companySettings,
	customer,
	estimate,
	estimateItem,
	invoice,
	invoiceItem,
	job,
	pricebookItem,
	serviceLocation,
	organization,
	outer
} from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import { emit } from './events.ts';
import { getSettings, nextNumber } from './settings.ts';
import { createJob } from './jobs.ts';
import { createInvoice } from './billing.ts';
import { addDays, localDate } from '#lib/tz.ts';
import { appOrigin } from '#lib/server/email.ts';
import type * as s from '#lib/schemas.ts';
import type * as v from 'valibot';

// ---------- Public approval link ----------

function sign(payload: string) {
	return createHmac('sha256', BETTER_AUTH_SECRET).update(`estimate:${payload}`).digest('base64url');
}

/** Stateless signed link to the public approve/decline page (`/e/<id>.<sig>`). */
export function estimateToken(estimateId: string) {
	return `${estimateId}.${sign(estimateId)}`;
}

export function verifyEstimateToken(token: string) {
	const m = /^([0-9a-f-]{36})\.([\w-]+)$/.exec(token.trim());
	if (!m) return null;
	const [, estimateId, sig] = m;
	const expected = Buffer.from(sign(estimateId!));
	const given = Buffer.from(sig!);
	return expected.length === given.length && timingSafeEqual(expected, given) ? estimateId! : null;
}

export function estimateUrl(id: string) {
	return `${appOrigin()}/e/${estimateToken(id)}`;
}

// ---------- Staff side ----------

/** Live expiry: a `sent` row past `valid_until` reads as `expired` everywhere, even pre-cron. */
function withExpiry<T extends { status: string; validUntil: string | null }>(row: T): T {
	if (row.status === 'sent' && row.validUntil && row.validUntil < todayIso())
		return { ...row, status: 'expired' };
	return row;
}

export async function listEstimates(orgId: string, status?: string[]) {
	const rows = await db
		.select({
			estimate,
			customerName: customer.name,
			companyName: customer.companyName,
			total:
				sql<number>`coalesce((select sum(i.qty * i.unit_price) from ${estimateItem} i where i.estimate_id = ${outer(estimate.id)}), 0)`.mapWith(
					Number
				),
			viewed: sql<boolean>`exists (select 1 from ${activity} a where a.entity_type = 'estimate' and a.entity_id = ${outer(estimate.id)} and a.action = 'viewed')`
		})
		.from(estimate)
		.innerJoin(customer, eq(estimate.customerId, customer.id))
		.where(eq(estimate.organizationId, orgId))
		.orderBy(desc(estimate.createdAt));
	return rows
		.map((r) => ({ ...r, estimate: withExpiry(r.estimate) }))
		.filter((r) => !status?.length || status.includes(r.estimate.status));
}

export async function getEstimate(orgId: string, id: string) {
	const [row] = await db
		.select({ estimate, customer, location: serviceLocation })
		.from(estimate)
		.innerJoin(customer, eq(estimate.customerId, customer.id))
		.leftJoin(serviceLocation, eq(estimate.serviceLocationId, serviceLocation.id))
		.where(and(eq(estimate.organizationId, orgId), eq(estimate.id, id)));
	if (!row) error(404, 'Estimate not found');
	const items = await db
		.select({ item: estimateItem, pricebookName: pricebookItem.name })
		.from(estimateItem)
		.leftJoin(pricebookItem, eq(estimateItem.pricebookItemId, pricebookItem.id))
		.where(eq(estimateItem.estimateId, id))
		.orderBy(asc(estimateItem.position));
	row.estimate = withExpiry(row.estimate);
	const linkedJob = row.estimate.jobId
		? (
				await db
					.select({ id: job.id, number: job.number, status: job.status })
					.from(job)
					.where(eq(job.id, row.estimate.jobId))
			)[0]
		: null;
	const [viewed] = await db
		.select({ at: activity.createdAt })
		.from(activity)
		.where(
			and(
				eq(activity.entityType, 'estimate'),
				eq(activity.entityId, row.estimate.id),
				eq(activity.action, 'viewed')
			)
		)
		.orderBy(desc(activity.createdAt))
		.limit(1);
	const [{ n: viewCount }] = await db
		.select({ n: count() })
		.from(activity)
		.where(
			and(
				eq(activity.entityType, 'estimate'),
				eq(activity.entityId, row.estimate.id),
				eq(activity.action, 'viewed')
			)
		);
	return {
		...row,
		items,
		linkedJob,
		viewedAt: viewed?.at ?? null,
		viewCount,
		token: estimateToken(row.estimate.id)
	};
}

async function writeItems(
	estimateId: string,
	items: v.InferOutput<typeof s.estimateInput>['items']
) {
	await db.delete(estimateItem).where(eq(estimateItem.estimateId, estimateId));
	if (!items.length) return;
	await db.insert(estimateItem).values(
		items.map((it, i) => ({
			estimateId,
			pricebookItemId: it.pricebookItemId ?? null,
			name: it.name,
			description: it.description,
			qty: it.qty,
			unitPrice: it.unitPrice,
			optional: it.optional ?? false,
			optionGroup: it.optionGroup ?? '',
			position: i
		}))
	);
}

export async function createEstimate(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.estimateInput>
) {
	const [c] = await db
		.select()
		.from(customer)
		.where(and(eq(customer.organizationId, ctx.orgId), eq(customer.id, input.customerId)));
	if (!c) error(404, 'Customer not found');
	const number = await nextNumber(ctx.orgId, 'estimate');
	const [row] = await db
		.insert(estimate)
		.values({
			organizationId: ctx.orgId,
			number,
			customerId: input.customerId,
			serviceLocationId: input.serviceLocationId ?? null,
			jobTypeId: input.jobTypeId ?? null,
			notes: input.notes,
			internalNotes: input.internalNotes,
			customerPo: input.customerPo
		})
		.returning();
	await writeItems(row!.id, input.items);
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'estimate',
		entityId: row!.id,
		action: 'created',
		summary: `Estimate E-${number} for ${c.name}`
	});
	return row;
}

export async function updateEstimate(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.estimateUpdate>
) {
	const [existing] = await db
		.select()
		.from(estimate)
		.where(and(eq(estimate.organizationId, ctx.orgId), eq(estimate.id, input.id)));
	if (!existing) error(404, 'Estimate not found');
	if (existing.status !== 'draft') error(409, 'Only drafts can be edited');
	const [row] = await db
		.update(estimate)
		.set({
			serviceLocationId: input.serviceLocationId,
			jobTypeId: input.jobTypeId,
			notes: input.notes,
			internalNotes: input.internalNotes,
			customerPo: input.customerPo,
			validUntil: input.validUntil
		})
		.where(eq(estimate.id, input.id))
		.returning();
	if (input.items) await writeItems(input.id, input.items);
	return row;
}

/** Creates revision N+1 of a sent/decided estimate as a new draft; the old one is marked superseded. */
export async function reviseEstimate(ctx: OrgContext, id: string) {
	const [e] = await db
		.select()
		.from(estimate)
		.where(and(eq(estimate.organizationId, ctx.orgId), eq(estimate.id, id)));
	if (!e) error(404, 'Estimate not found');
	if (e.status !== 'sent' && e.status !== 'declined' && e.status !== 'expired')
		error(409, 'Only sent, declined, or expired estimates can be revised');
	const items = await db
		.select()
		.from(estimateItem)
		.where(eq(estimateItem.estimateId, id))
		.orderBy(asc(estimateItem.position));
	const row = await db.transaction(async (tx) => {
		await tx
			.update(estimate)
			.set({ status: 'superseded', updatedAt: new Date() })
			.where(eq(estimate.id, id));
		const [inserted] = await tx
			.insert(estimate)
			.values({
				organizationId: ctx.orgId,
				number: e.number,
				customerId: e.customerId,
				serviceLocationId: e.serviceLocationId,
				jobTypeId: e.jobTypeId,
				notes: e.notes,
				version: e.version + 1,
				supersedesId: e.id
			})
			.returning();
		return inserted;
	});
	if (items.length)
		await db.insert(estimateItem).values(
			items.map((it, i) => ({
				estimateId: row!.id,
				pricebookItemId: it.pricebookItemId,
				name: it.name,
				description: it.description,
				qty: it.qty,
				unitPrice: it.unitPrice,
				optional: it.optional,
				optionGroup: it.optionGroup,
				position: i
			}))
		);
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'estimate',
		entityId: row!.id,
		action: 'revised',
		summary: `Estimate E-${e.number} revised to v${e.version + 1}`
	});
	return row;
}

/** Copies an estimate (any status) into a brand-new draft with a fresh E-number. */
export async function duplicateEstimate(ctx: OrgContext, id: string) {
	const [e] = await db
		.select()
		.from(estimate)
		.where(and(eq(estimate.organizationId, ctx.orgId), eq(estimate.id, id)));
	if (!e) error(404, 'Estimate not found');
	const items = await db
		.select()
		.from(estimateItem)
		.where(eq(estimateItem.estimateId, id))
		.orderBy(asc(estimateItem.position));
	const number = await nextNumber(ctx.orgId, 'estimate');
	const [row] = await db
		.insert(estimate)
		.values({
			organizationId: ctx.orgId,
			number,
			customerId: e.customerId,
			serviceLocationId: e.serviceLocationId,
			notes: e.notes
		})
		.returning();
	if (items.length)
		await db.insert(estimateItem).values(
			items.map((it, i) => ({
				estimateId: row!.id,
				pricebookItemId: it.pricebookItemId,
				name: it.name,
				description: it.description,
				qty: it.qty,
				unitPrice: it.unitPrice,
				optional: it.optional,
				optionGroup: it.optionGroup,
				position: i
			}))
		);
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'estimate',
		entityId: row!.id,
		action: 'created',
		summary: `Estimate E-${number} copied from E-${e.number}`
	});
	return row;
}

/**
 * The accepted scope of a decided estimate: base lines + the picked option group's
 * lines + the optional lines kept at decision time. Estimates decided before
 * options existed (no acceptedOption, no kept optionals) keep every line.
 */
export function acceptedScope<T extends { id: string; optionGroup: string; optional: boolean }>(
	e: { acceptedOption: string | null; acceptedItems: string[] | null },
	items: T[]
): T[] {
	const kept = new Set(e.acceptedItems ?? []);
	if (e.acceptedOption == null && kept.size === 0) return items;
	return items.filter(
		(i) =>
			(i.optionGroup === '' || i.optionGroup === e.acceptedOption) &&
			(!i.optional || kept.has(i.id))
	);
}

/** Turns an approved estimate straight into a draft invoice (skips job conversion). */
export async function invoiceEstimate(ctx: OrgContext, id: string) {
	const [e] = await db
		.select()
		.from(estimate)
		.where(and(eq(estimate.organizationId, ctx.orgId), eq(estimate.id, id)));
	if (!e) error(404, 'Estimate not found');
	if (e.status !== 'approved' && e.status !== 'converted')
		error(409, 'Only approved estimates can be invoiced');
	const items = acceptedScope(
		e,
		await db
			.select()
			.from(estimateItem)
			.where(eq(estimateItem.estimateId, id))
			.orderBy(asc(estimateItem.position))
	);
	if (!items.length) error(409, 'Estimate has no accepted line items');
	const [settings, [cust]] = await Promise.all([
		getSettings(ctx.orgId),
		db.select().from(customer).where(eq(customer.id, e.customerId)).limit(1)
	]);
	const inv = await createInvoice(ctx, {
		customerId: e.customerId,
		jobId: e.jobId ?? null,
		dueDate: addDays(
			localDate(new Date(), settings.timezone),
			cust?.termsDays ?? settings.invoiceTermsDays
		),
		notes: `From estimate E-${e.number}${e.version > 1 ? ` v${e.version}` : ''}`,
		items: items.map((it) => ({
			pricebookItemId: it.pricebookItemId,
			name: it.name,
			description: it.description,
			qty: it.qty,
			unitPrice: it.unitPrice
		}))
	});
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'estimate',
		entityId: id,
		action: 'invoiced',
		summary: `Estimate E-${e.number} invoiced as INV-${inv.number}`,
		data: { invoiceId: inv.id }
	});
	return inv;
}

/** Total billed so far against an estimate's progress-billing lines. */
export async function estimateProgress(ctx: OrgContext, id: string) {
	const [e] = await db
		.select()
		.from(estimate)
		.where(and(eq(estimate.organizationId, ctx.orgId), eq(estimate.id, id)));
	if (!e) error(404, 'Estimate not found');
	const items = acceptedScope(
		e,
		await db
			.select({
				id: estimateItem.id,
				optionGroup: estimateItem.optionGroup,
				optional: estimateItem.optional,
				qty: estimateItem.qty,
				unitPrice: estimateItem.unitPrice
			})
			.from(estimateItem)
			.where(eq(estimateItem.estimateId, id))
	);
	const total = items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
	const [{ invoiced }] = await db
		.select({
			invoiced:
				sql<number>`coalesce(sum(${invoiceItem.qty} * ${invoiceItem.unitPrice}), 0)`.mapWith(Number)
		})
		.from(invoiceItem)
		.innerJoin(invoice, eq(invoiceItem.invoiceId, invoice.id))
		.where(and(eq(invoiceItem.description, `estimate:${id}`), sql`${invoice.status} <> 'void'`));
	return { total, invoiced };
}

/**
 * Progress billing: cuts an invoice for `pct`% of the estimate total as a single
 * "Progress billing" line (marked `estimate:<id>` so the running total is computable).
 */
export async function progressInvoiceEstimate(ctx: OrgContext, id: string, pct: number) {
	const [e] = await db
		.select()
		.from(estimate)
		.where(and(eq(estimate.organizationId, ctx.orgId), eq(estimate.id, id)));
	if (!e) error(404, 'Estimate not found');
	if (e.status !== 'approved' && e.status !== 'converted')
		error(409, 'Only approved estimates can be invoiced');
	const { total, invoiced } = await estimateProgress(ctx, id);
	const remaining = total - invoiced;
	if (remaining <= 0) error(409, 'Estimate already fully invoiced');
	const amount = Math.min(Math.round((total * pct) / 100), remaining);
	const [settings, [cust]] = await Promise.all([
		getSettings(ctx.orgId),
		db.select().from(customer).where(eq(customer.id, e.customerId)).limit(1)
	]);
	const inv = await createInvoice(ctx, {
		customerId: e.customerId,
		jobId: e.jobId ?? null,
		dueDate: addDays(
			localDate(new Date(), settings.timezone),
			cust?.termsDays ?? settings.invoiceTermsDays
		),
		notes: `Progress billing — estimate E-${e.number} (${pct}%)`,
		items: [
			{
				pricebookItemId: null,
				name: `Progress billing — ${pct}% of estimate E-${e.number}`,
				description: `estimate:${e.id}`,
				qty: 1,
				unitPrice: amount
			}
		]
	});
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'estimate',
		entityId: id,
		action: 'invoiced',
		summary: `Estimate E-${e.number} progress-invoiced ${pct}% as INV-${inv.number}`,
		data: { invoiceId: inv.id }
	});
	return inv;
}

/** Marks the estimate sent; the public link can now be shared with the customer. */
export async function sendEstimate(ctx: OrgContext, id: string) {
	// Quotes default to the workspace's validity window unless staff set a different expiry.
	const o = await getSettings(ctx.orgId);
	const defaultValidUntil = new Date(Date.now() + (o.estimateValidDays ?? 30) * 86400_000)
		.toISOString()
		.slice(0, 10);
	const [row] = await db
		.update(estimate)
		.set({
			status: 'sent',
			sentAt: new Date(),
			validUntil: sql`coalesce(${estimate.validUntil}, ${defaultValidUntil})`
		})
		.where(
			and(eq(estimate.organizationId, ctx.orgId), eq(estimate.id, id), eq(estimate.status, 'draft'))
		)
		.returning();
	if (!row) error(409, 'Estimate is not a draft');
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'estimate',
		entityId: id,
		action: 'sent',
		summary: `Estimate E-${row.number} sent`
	});
	return { ...row, url: estimateUrl(row.id) };
}

/** Re-emails the link for an already-sent estimate and refreshes sentAt (extends the 30d window). */
export async function resendEstimate(ctx: OrgContext, id: string) {
	const [row] = await db
		.update(estimate)
		.set({ sentAt: new Date() })
		.where(
			and(eq(estimate.organizationId, ctx.orgId), eq(estimate.id, id), eq(estimate.status, 'sent'))
		)
		.returning();
	if (!row) error(409, 'Only a sent estimate can be resent');
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'estimate',
		entityId: id,
		action: 'resent',
		summary: `Estimate E-${row.number} resent`
	});
	return { ...row, url: estimateUrl(row.id) };
}

// ---------- Public side ----------

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Flips sent estimates past their validUntil to 'expired' (daily cron + opportunistic read). */
export async function expireEstimates(orgId: string) {
	await db
		.update(estimate)
		.set({ status: 'expired' })
		.where(
			and(
				eq(estimate.organizationId, orgId),
				eq(estimate.status, 'sent'),
				lt(estimate.validUntil, todayIso())
			)
		);
}

/** What the public /e/[token] page shows. */
export async function publicEstimate(id: string) {
	// A sent estimate past its validity reads as expired even before the cron flips it.
	const [row] = await db
		.select({
			estimate,
			customerName: customer.name,
			orgName: organization.name,
			orgLogoUrl: companySettings.logoUrl,
			location: serviceLocation
		})
		.from(estimate)
		.innerJoin(customer, eq(estimate.customerId, customer.id))
		.innerJoin(organization, eq(organization.id, estimate.organizationId))
		.leftJoin(companySettings, eq(companySettings.organizationId, estimate.organizationId))
		.leftJoin(serviceLocation, eq(estimate.serviceLocationId, serviceLocation.id))
		.where(eq(estimate.id, id));
	if (!row) error(404, 'Estimate not found');
	const items = await db
		.select()
		.from(estimateItem)
		.where(eq(estimateItem.estimateId, id))
		.orderBy(asc(estimateItem.position));
	const [settings] = await db
		.select({ currency: companySettings.currency })
		.from(companySettings)
		.where(eq(companySettings.organizationId, row.estimate.organizationId));
	row.estimate = withExpiry(row.estimate);
	// First customer open of a sent estimate leaves a 'viewed' trail for staff.
	if (row.estimate.status === 'sent') {
		const [seen] = await db
			.select({ id: activity.id })
			.from(activity)
			.where(
				and(
					eq(activity.entityType, 'estimate'),
					eq(activity.entityId, id),
					eq(activity.action, 'viewed')
				)
			)
			.limit(1);
		if (!seen) {
			await emit({
				orgId: row.estimate.organizationId,
				entityType: 'estimate',
				entityId: id,
				action: 'viewed',
				summary: `${row.customerName} opened estimate E-${row.estimate.number}`
			});
			const { notifyStaffEstimateViewed } = await import('./notifications.ts');
			notifyStaffEstimateViewed(row.estimate.organizationId, id).catch((err) =>
				console.error('estimate-viewed alert failed', err)
			);
		}
	}
	// internal_notes is staff-only — strip it before serializing to the public page.
	row.estimate.internalNotes = '';
	return { ...row, items, currency: settings?.currency ?? 'usd' };
}

/**
 * Approve or decline on the public link. Approval creates an unscheduled job carrying
 * the quoted line items as its description, ready for the dispatcher.
 */
export async function decideEstimate(
	token: string,
	ip: string,
	input: v.InferOutput<typeof s.estimateDecisionInput>
) {
	const estimateId = verifyEstimateToken(token);
	if (!estimateId) error(400, 'Invalid link');
	const [est] = await db.select().from(estimate).where(eq(estimate.id, estimateId));
	if (!est) error(404, 'Estimate not found');
	if (
		est.status === 'expired' ||
		(est.status === 'sent' && est.validUntil && est.validUntil < todayIso())
	) {
		error(409, 'This estimate has expired — ask for a new one');
	}
	if (est.status !== 'sent') error(409, 'This estimate has already been answered');

	if (input.approve && !input.name) error(400, 'Type your name to approve');

	const [c] = await db.select().from(customer).where(eq(customer.id, est.customerId));
	return applyDecision(est, c, input, `ip ${ip}`);
}

/** Customer asks for changes on the public link — keeps status 'sent', logs the
 * request on the estimate and pings staff (notification + email via caller). */
export async function requestEstimateChanges(
	token: string,
	ip: string,
	input: { name?: string; note: string }
) {
	const estimateId = verifyEstimateToken(token);
	if (!estimateId) error(400, 'Invalid link');
	const [est] = await db.select().from(estimate).where(eq(estimate.id, estimateId));
	if (!est) error(404, 'Estimate not found');
	if (
		est.status === 'expired' ||
		(est.status === 'sent' && est.validUntil && est.validUntil < todayIso())
	)
		error(409, 'This estimate has expired — ask for a new one');
	if (est.status !== 'sent') error(409, 'This estimate has already been answered');
	const req = `Changes requested by ${input.name || 'customer'} (ip ${ip}): ${input.note.slice(0, 400)}`;
	await db
		.update(estimate)
		.set({
			decisionNote: est.decisionNote ? `${est.decisionNote} | ${req}` : req,
			updatedAt: new Date()
		})
		.where(eq(estimate.id, est.id));
	return { organizationId: est.organizationId, id: est.id };
}

/**
 * Staff records a verbal/phone approval or decline on a sent estimate — same
 * conversion as the public link (job creation, deposit invoice, decision note).
 */
export async function decideEstimateStaff(
	ctx: OrgContext,
	id: string,
	approve: boolean,
	actor: string,
	option?: string
) {
	const [est] = await db
		.select()
		.from(estimate)
		.where(and(eq(estimate.organizationId, ctx.orgId), eq(estimate.id, id)));
	if (!est) error(404, 'Estimate not found');
	if (est.status !== 'sent') error(409, 'Only sent estimates can be decided');
	const [c] = await db.select().from(customer).where(eq(customer.id, est.customerId));
	// Staff approvals bill as-quoted: every optional line stays included.
	let items: string[] | undefined;
	if (approve)
		items = (
			await db
				.select({ id: estimateItem.id })
				.from(estimateItem)
				.where(and(eq(estimateItem.estimateId, id), eq(estimateItem.optional, true)))
		).map((r) => r.id);
	return applyDecision(
		est,
		c,
		{ approve, name: approve ? actor : null, items, option },
		`staff ${actor}`
	);
}

async function applyDecision(
	est: typeof estimate.$inferSelect,
	c: typeof customer.$inferSelect | undefined,
	input: {
		approve: boolean;
		name?: string | null;
		items?: string[];
		note?: string | null;
		option?: string | null;
	},
	via: string
) {
	let jobId: string | null = null;
	const chosen = new Set(input.items ?? []);
	let pickedOption: string | null = null;
	if (input.approve) {
		const all = await db
			.select()
			.from(estimateItem)
			.where(eq(estimateItem.estimateId, est.id))
			.orderBy(asc(estimateItem.position));
		const groups = [...new Set(all.map((i) => i.optionGroup).filter((g) => g))];
		if (groups.length) {
			pickedOption = input.option?.trim() || null;
			if (!pickedOption || !groups.includes(pickedOption))
				error(400, 'Pick one of the options to approve');
		}
		const items = all.filter(
			(i) =>
				(i.optionGroup === '' || i.optionGroup === pickedOption) &&
				(!i.optional || chosen.has(i.id))
		);
		const description = [
			`Approved estimate E-${est.number}${input.name ? ` by ${input.name}` : ''}${pickedOption ? ` — option "${pickedOption}"` : ''}.`,
			est.notes,
			'',
			...items.map((i) => `${i.qty} × ${i.name}`)
		]
			.filter(Boolean)
			.join('\n');
		const created = await createJob(
			{ orgId: est.organizationId, userId: null },
			'UTC',
			{
				customerId: est.customerId,
				serviceLocationId: est.serviceLocationId,
				jobTypeId: est.jobTypeId,
				summary: `From estimate E-${est.number}`,
				description,
				preferredTime: null,
				priority: 'normal'
			},
			{ source: 'estimate' }
		);
		jobId = created!.id;
		// Link back so invoicePrefill bills the estimate's items for this job.
		await db.update(job).set({ estimateId: est.id }).where(eq(job.id, jobId));

		// Deposit on approval: when the org collects a percentage up front, cut a
		// deposit invoice for that share of the estimate total and email the pay link.
		const settings = await getSettings(est.organizationId);
		const pct = settings.estimateDepositPct;
		const total = items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
		if (pct > 0 && total > 0) {
			const dep = await createInvoice(
				{ orgId: est.organizationId, userId: null },
				{
					customerId: est.customerId,
					dueDate: todayIso(),
					notes: `Deposit for estimate E-${est.number}`,
					items: [
						{
							pricebookItemId: null,
							name: `Deposit — estimate E-${est.number} (${pct}%)`,
							description: '',
							qty: 1,
							unitPrice: Math.round((total * pct) / 100)
						}
					]
				}
			);
			const { notifyInvoiceSent } = await import('./notifications.ts');
			notifyInvoiceSent(est.organizationId, dep!.id).catch((err) =>
				console.error('deposit invoice email failed', err)
			);
		}
	}

	const [row] = await db
		.update(estimate)
		.set({
			status: input.approve ? 'converted' : 'declined',
			respondedAt: new Date(),
			decisionName: input.approve ? input.name : null,
			acceptedOption: input.approve ? pickedOption : null,
			acceptedItems: input.approve ? [...chosen] : [],
			decisionNote: [
				input.approve ? 'approved' : 'declined',
				via,
				pickedOption ? `option: ${pickedOption}` : null,
				input.note || null,
				chosen.size ? `extras: ${[...chosen].join(',')}` : null
			]
				.filter(Boolean)
				.join(' · '),
			jobId
		})
		.where(eq(estimate.id, est.id))
		.returning();

	await emit({
		orgId: est.organizationId,
		entityType: 'estimate',
		entityId: est.id,
		action: input.approve ? 'approved' : 'declined',
		summary: `E-${est.number} ${input.approve ? `approved by ${input.name}` : 'declined'} — ${c?.name ?? 'customer'}`,
		data: { jobId }
	});
	return row;
}
