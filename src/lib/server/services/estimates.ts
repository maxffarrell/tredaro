import { createHmac, timingSafeEqual } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { and, asc, desc, eq, lt, sql } from 'drizzle-orm';
import { BETTER_AUTH_SECRET } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import {
	companySettings,
	customer,
	estimate,
	estimateItem,
	job,
	pricebookItem,
	serviceLocation,
	organization,
	outer
} from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import { emit } from './events.ts';
import { nextNumber } from './settings.ts';
import { createJob } from './jobs.ts';
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

export async function listEstimates(orgId: string, status?: string) {
	const rows = await db
		.select({
			estimate,
			customerName: customer.name,
			companyName: customer.companyName,
			total:
				sql<number>`coalesce((select sum(i.qty * i.unit_price) from ${estimateItem} i where i.estimate_id = ${outer(estimate.id)}), 0)`.mapWith(
					Number
				)
		})
		.from(estimate)
		.innerJoin(customer, eq(estimate.customerId, customer.id))
		.where(eq(estimate.organizationId, orgId))
		.orderBy(desc(estimate.createdAt));
	return rows
		.map((r) => ({ ...r, estimate: withExpiry(r.estimate) }))
		.filter((r) => !status || r.estimate.status === status);
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
	return { ...row, items, linkedJob, token: estimateToken(row.estimate.id) };
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
			notes: input.notes
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
			notes: input.notes,
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

/** Marks the estimate sent; the public link can now be shared with the customer. */
export async function sendEstimate(ctx: OrgContext, id: string) {
	// Quotes default to a 30-day validity window unless staff set a different date.
	const defaultValidUntil = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
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
			location: serviceLocation
		})
		.from(estimate)
		.innerJoin(customer, eq(estimate.customerId, customer.id))
		.innerJoin(organization, eq(organization.id, estimate.organizationId))
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

	let jobId: string | null = null;
	if (input.approve) {
		const items = await db
			.select()
			.from(estimateItem)
			.where(eq(estimateItem.estimateId, estimateId))
			.orderBy(asc(estimateItem.position));
		const description = [
			`Approved estimate E-${est.number}${input.name ? ` by ${input.name}` : ''}.`,
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
				summary: `From estimate E-${est.number}`,
				description,
				preferredTime: null,
				priority: 'normal'
			},
			{ source: 'estimate' }
		);
		jobId = created!.id;
	}

	const [row] = await db
		.update(estimate)
		.set({
			status: input.approve ? 'converted' : 'declined',
			respondedAt: new Date(),
			decisionName: input.approve ? input.name : null,
			decisionNote: [input.approve ? 'approved' : 'declined', `ip ${ip}`, input.note || null]
				.filter(Boolean)
				.join(' · '),
			jobId
		})
		.where(eq(estimate.id, estimateId))
		.returning();

	await emit({
		orgId: est.organizationId,
		entityType: 'estimate',
		entityId: estimateId,
		action: input.approve ? 'approved' : 'declined',
		summary: `E-${est.number} ${input.approve ? `approved by ${input.name}` : 'declined'} — ${c?.name ?? 'customer'}`,
		data: { jobId }
	});
	return row;
}
