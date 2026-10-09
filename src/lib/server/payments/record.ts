import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { charge, companySettings, customer, payment } from '#lib/server/db/schema.ts';
import { allocate } from '#lib/server/allocation.ts';
import { formatMoney } from '#lib/format.ts';
import { emit } from '#lib/server/services/events.ts';

type OnlinePayment = {
	orgId: string;
	customerId: string;
	/** Minor units. */
	amount: number;
	method: (typeof payment.$inferInsert)['method'];
	/** Provider-unique payment ID; recording the same ID twice is a no-op. */
	externalId: string;
	provider: string;
	/** When set, allocate only to these charges (portal per-charge selection). */
	chargeIds?: string[];
};

/**
 * Records a provider-confirmed payment, applied to the customer's open charges oldest-first.
 * Safe to call more than once for the same `externalId`.
 */
export async function recordOnlinePayment(p: OnlinePayment) {
	if (p.amount <= 0) return;
	const [m] = await db
		.select({ id: customer.id })
		.from(customer)
		.where(and(eq(customer.organizationId, p.orgId), eq(customer.id, p.customerId)));
	if (!m) return;

	const rows = await db.transaction(async (tx) => {
		const open = await tx
			.select({
				id: charge.id,
				open: sql<number>`${charge.amount} - coalesce((select sum(p.amount) from ${payment} p where p.charge_id = "charge"."id"), 0)`.mapWith(
					Number
				)
			})
			.from(charge)
			.where(
				and(
					eq(charge.customerId, p.customerId),
					eq(charge.status, 'open'),
					p.chargeIds?.length ? inArray(charge.id, p.chargeIds) : undefined
				)
			)
			.orderBy(asc(charge.dueDate), asc(charge.createdAt));
		const inserted = [];
		for (const [i, part] of allocate(p.amount, open).entries()) {
			const [row] = await tx
				.insert(payment)
				.values({
					organizationId: p.orgId,
					customerId: p.customerId,
					chargeId: part.chargeId,
					amount: part.amount,
					method: p.method,
					reference: p.externalId,
					notes: `Paid online with ${p.provider}`,
					// The unique index on the first part makes replayed webhooks a no-op.
					externalId: i === 0 ? p.externalId : `${p.externalId}:${i}`
				})
				.onConflictDoNothing()
				.returning();
			if (!row) return [];
			inserted.push(row);
		}
		return inserted;
	});
	const first = rows[0];
	if (!first) return;
	const [settings] = await db
		.select({ currency: companySettings.currency })
		.from(companySettings)
		.where(eq(companySettings.organizationId, p.orgId));
	await emit({
		orgId: p.orgId,
		entityType: 'payment',
		entityId: first.id,
		action: 'recorded',
		summary: `${formatMoney(p.amount, settings?.currency ?? 'usd')} paid online with ${p.provider}`,
		data: {
			customerId: p.customerId,
			amount: p.amount,
			method: p.method,
			online: true,
			payments: rows.map((r) => r.id)
		}
	});
	// Email a receipt per recorded part. Dynamic import keeps the
	// notifications → billing → payments import graph acyclic.
	const { notifyPaymentReceived } = await import('#lib/server/services/notifications.ts');
	notifyPaymentReceived(
		p.orgId,
		rows.map((r) => r.id)
	).catch((err) => console.error('payment receipt email failed', err));
}
