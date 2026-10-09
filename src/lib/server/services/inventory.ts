import { error } from '@sveltejs/kit';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	inventoryItem,
	job,
	jobMaterial,
	jobType,
	jobTypeMaterial,
	member,
	purchaseOrder,
	purchaseOrderItem,
	truckStock,
	user
} from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import { emit } from './events.ts';
import { notifyLowStock, rearmLowStock } from './notifications.ts';
import type * as s from '#lib/schemas.ts';
import type * as v from 'valibot';

/** Stock list — items with a `low` flag when on-hand is at/below the reorder point. */
export async function listItems(orgId: string) {
	const rows = await db
		.select({
			item: inventoryItem,
			used: sql<boolean>`exists(select 1 from ${jobMaterial} jm where jm.inventory_item_id = inventory_item.id)`,
			trucked:
				sql<number>`coalesce((select sum(ts.qty) from ${truckStock} ts where ts.inventory_item_id = inventory_item.id), 0)`.mapWith(
					Number
				),
			truckCount:
				sql<number>`(select count(*) from ${truckStock} ts2 where ts2.inventory_item_id = inventory_item.id and ts2.qty > 0)`.mapWith(
					Number
				),
			onOrder:
				sql<number>`coalesce((select sum(poi.qty - poi.received_qty) from ${purchaseOrderItem} poi join ${purchaseOrder} po on po.id = poi.purchase_order_id where poi.inventory_item_id = inventory_item.id and po.status = 'ordered'), 0)`.mapWith(
					Number
				)
		})
		.from(inventoryItem)
		.where(eq(inventoryItem.organizationId, orgId))
		.orderBy(asc(inventoryItem.name));
	return rows.map(({ item: i, used, trucked, truckCount, onOrder }) => ({
		item: i,
		used,
		trucked,
		truckCount,
		onOrder,
		low: i.reorderPoint != null && i.qtyOnHand <= i.reorderPoint
	}));
}

export async function createItem(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.inventoryItemInput>
) {
	const [i] = await db
		.insert(inventoryItem)
		.values({ organizationId: ctx.orgId, ...input })
		.returning();
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'inventory_item',
		entityId: i.id,
		action: 'created',
		summary: `Added inventory item ${i.name}`
	});
	return i;
}

export async function updateItem(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.inventoryItemUpdate>
) {
	const { id, ...rest } = input;
	const [i] = await db
		.update(inventoryItem)
		.set({ ...rest, updatedAt: new Date() })
		.where(and(eq(inventoryItem.id, id), eq(inventoryItem.organizationId, ctx.orgId)))
		.returning();
	if (!i) error(404, 'Item not found');
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'inventory_item',
		entityId: id,
		action: 'updated',
		summary: `Updated inventory item ${i.name}`
	});
	return i;
}

/** Manual stock correction — add or return `delta` units (always positive; sign picked by caller UI). */
export async function adjustQty(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.inventoryAdjustInput> & { direction: 'in' | 'out' }
) {
	const sign = input.direction === 'out' ? -1 : 1;
	const [i] = await db
		.update(inventoryItem)
		.set({ qtyOnHand: sql`${inventoryItem.qtyOnHand} + ${sign * input.delta}` })
		.where(and(eq(inventoryItem.id, input.id), eq(inventoryItem.organizationId, ctx.orgId)))
		.returning();
	if (!i) error(404, 'Item not found');
	if (i.qtyOnHand < 0) {
		await db.update(inventoryItem).set({ qtyOnHand: 0 }).where(eq(inventoryItem.id, input.id));
		i.qtyOnHand = 0;
	}
	if (sign > 0) void rearmLowStock(ctx.orgId, i.id).catch(() => {});
	else if (i.reorderPoint != null && i.qtyOnHand <= i.reorderPoint)
		void notifyLowStock(ctx.orgId, i.id).catch(() => {});
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'inventory_item',
		entityId: i.id,
		action: 'adjusted',
		summary: `Adjusted ${i.name} stock by ${sign * input.delta}`
	});
	return i;
}

/** Refuses while jobs reference the item (FK is restrict). */
export async function deleteItem(ctx: OrgContext, id: string) {
	const refs = await db
		.select({ id: jobMaterial.id })
		.from(jobMaterial)
		.where(eq(jobMaterial.inventoryItemId, id))
		.limit(1);
	if (refs.length) error(409, 'Jobs have logged this material — remove those entries first');
	const [i] = await db
		.delete(inventoryItem)
		.where(and(eq(inventoryItem.id, id), eq(inventoryItem.organizationId, ctx.orgId)))
		.returning();
	if (!i) error(404, 'Item not found');
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'inventory_item',
		entityId: id,
		action: 'deleted',
		summary: `Deleted inventory item ${i.name}`
	});
}

/** Materials logged on a job, newest first, with item + member names. */
export async function listJobMaterials(orgId: string, jobId: string) {
	return db
		.select({
			material: jobMaterial,
			itemName: inventoryItem.name,
			itemUnit: inventoryItem.unit,
			memberName: user.name
		})
		.from(jobMaterial)
		.innerJoin(inventoryItem, eq(jobMaterial.inventoryItemId, inventoryItem.id))
		.leftJoin(member, eq(jobMaterial.memberId, member.id))
		.leftJoin(user, eq(member.userId, user.id))
		.where(and(eq(jobMaterial.organizationId, orgId), eq(jobMaterial.jobId, jobId)))
		.orderBy(sql`${jobMaterial.createdAt} desc`);
}

/** Log stock usage on a job — decrements on-hand; 409s when there isn't enough. */
export async function addMaterial(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.jobMaterialInput>
) {
	return db.transaction(async (tx) => {
		const [item] = await tx
			.select()
			.from(inventoryItem)
			.where(
				and(
					eq(inventoryItem.id, input.inventoryItemId),
					eq(inventoryItem.organizationId, ctx.orgId)
				)
			)
			.limit(1);
		if (!item) error(404, 'Item not found');
		if (!input.truckMemberId && item.qtyOnHand < input.qty)
			error(409, `Only ${item.qtyOnHand} ${item.unit} of ${item.name} on hand`);
		const me = ctx.userId
			? (
					await tx
						.select({ id: member.id })
						.from(member)
						.where(and(eq(member.userId, ctx.userId), eq(member.organizationId, ctx.orgId)))
						.limit(1)
				)[0]
			: null;
		const truckMemberId = input.truckMemberId ?? null;
		if (truckMemberId) {
			const [ts] = await tx
				.select()
				.from(truckStock)
				.where(
					and(
						eq(truckStock.memberId, truckMemberId),
						eq(truckStock.inventoryItemId, input.inventoryItemId),
						eq(truckStock.organizationId, ctx.orgId)
					)
				)
				.limit(1);
			if (!ts || ts.qty < input.qty)
				error(409, `Only ${ts?.qty ?? 0} ${item.unit} of ${item.name} on that truck`);
			await tx
				.update(truckStock)
				.set({ qty: sql`${truckStock.qty} - ${input.qty}` })
				.where(eq(truckStock.id, ts.id));
		} else {
			await tx
				.update(inventoryItem)
				.set({ qtyOnHand: sql`${inventoryItem.qtyOnHand} - ${input.qty}` })
				.where(eq(inventoryItem.id, item.id));
			if (item.reorderPoint != null && item.qtyOnHand - input.qty <= item.reorderPoint)
				void notifyLowStock(ctx.orgId, item.id).catch((err) =>
					console.error('low-stock alert failed', err)
				);
		}
		const [m] = await tx
			.insert(jobMaterial)
			.values({
				organizationId: ctx.orgId,
				jobId: input.jobId,
				inventoryItemId: input.inventoryItemId,
				qty: input.qty,
				unitPrice: input.unitPrice,
				memberId: me?.id ?? null,
				sourceMemberId: truckMemberId
			})
			.returning();
		void emit({
			orgId: ctx.orgId,
			actorId: ctx.userId,
			entityType: 'job',
			entityId: input.jobId,
			action: 'material_added',
			summary: `Used ${input.qty} × ${item.name}`
		});
		void emit({
			orgId: ctx.orgId,
			actorId: ctx.userId,
			entityType: 'inventory_item',
			entityId: item.id,
			action: 'material_added',
			summary: `Used ${input.qty} ${item.unit} on a job${truckMemberId ? ' (from truck)' : ''}`
		});
		return m;
	});
}

/** Remove a logged material — returns the qty to stock. */
export async function removeMaterial(ctx: OrgContext, materialId: string) {
	return db.transaction(async (tx) => {
		const [m] = await tx
			.delete(jobMaterial)
			.where(and(eq(jobMaterial.id, materialId), eq(jobMaterial.organizationId, ctx.orgId)))
			.returning();
		if (!m) error(404, 'Material not found');
		if (m.sourceMemberId) {
			await tx
				.insert(truckStock)
				.values({
					organizationId: ctx.orgId,
					memberId: m.sourceMemberId,
					inventoryItemId: m.inventoryItemId,
					qty: m.qty
				})
				.onConflictDoUpdate({
					target: [truckStock.memberId, truckStock.inventoryItemId],
					set: { qty: sql`${truckStock.qty} + ${m.qty}` }
				});
		} else {
			await tx
				.update(inventoryItem)
				.set({ qtyOnHand: sql`${inventoryItem.qtyOnHand} + ${m.qty}` })
				.where(eq(inventoryItem.id, m.inventoryItemId));
			void rearmLowStock(ctx.orgId, m.inventoryItemId).catch(() => {});
		}
		void emit({
			orgId: ctx.orgId,
			actorId: ctx.userId,
			entityType: 'job',
			entityId: m.jobId,
			action: 'material_removed',
			summary: `Returned ${m.qty} × material`
		});
		void emit({
			orgId: ctx.orgId,
			actorId: ctx.userId,
			entityType: 'inventory_item',
			entityId: m.inventoryItemId,
			action: 'material_removed',
			summary: `Returned ${m.qty} to ${m.sourceMemberId ? 'truck' : 'stock'} from a job`
		});
		return m;
	});
}

/** Items at/below reorder point — feeds the dashboard attention card. */
export async function lowStock(orgId: string) {
	return db
		.select()
		.from(inventoryItem)
		.where(
			and(
				eq(inventoryItem.organizationId, orgId),
				sql`${inventoryItem.reorderPoint} is not null`,
				sql`${inventoryItem.qtyOnHand} <= ${inventoryItem.reorderPoint}`
			)
		)
		.orderBy(asc(inventoryItem.qtyOnHand))
		.limit(4);
}

// ---------- Material kits (job-type defaults) ----------

/** All kit lines in the org, joined with item names — the settings editor groups by type. */
export async function listJobTypeKits(orgId: string) {
	return db
		.select({
			jobTypeId: jobTypeMaterial.jobTypeId,
			inventoryItemId: jobTypeMaterial.inventoryItemId,
			qty: jobTypeMaterial.qty,
			itemName: inventoryItem.name,
			itemUnit: inventoryItem.unit
		})
		.from(jobTypeMaterial)
		.innerJoin(inventoryItem, eq(jobTypeMaterial.inventoryItemId, inventoryItem.id))
		.where(eq(jobTypeMaterial.organizationId, orgId))
		.orderBy(asc(jobTypeMaterial.jobTypeId), asc(inventoryItem.name));
}

/** Replace a job type's kit (admin). Validates the type and items belong to the org. */
export async function setJobTypeKit(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.jobTypeKitInput>
) {
	const [jt] = await db
		.select({ id: jobType.id })
		.from(jobType)
		.where(and(eq(jobType.organizationId, ctx.orgId), eq(jobType.id, input.jobTypeId)));
	if (!jt) error(404, 'Job type not found');
	if (input.items.length) {
		const items = await db
			.select({ id: inventoryItem.id })
			.from(inventoryItem)
			.where(
				and(
					eq(inventoryItem.organizationId, ctx.orgId),
					inArray(
						inventoryItem.id,
						input.items.map((i) => i.inventoryItemId)
					)
				)
			);
		if (items.length !== new Set(input.items.map((i) => i.inventoryItemId)).size)
			error(404, 'Inventory item not found');
	}
	await db.transaction(async (tx) => {
		await tx
			.delete(jobTypeMaterial)
			.where(
				and(
					eq(jobTypeMaterial.organizationId, ctx.orgId),
					eq(jobTypeMaterial.jobTypeId, input.jobTypeId)
				)
			);
		if (input.items.length)
			await tx.insert(jobTypeMaterial).values(
				input.items.map((i) => ({
					organizationId: ctx.orgId,
					jobTypeId: input.jobTypeId,
					inventoryItemId: i.inventoryItemId,
					qty: i.qty
				}))
			);
	});
	return { jobTypeId: input.jobTypeId, count: input.items.length };
}

/**
 * Apply a job's type kit: log each kit line as warehouse materials on the job.
 * Items with insufficient stock are skipped (each addMaterial is atomic) so a
 * partial kit still lands; the response reports both counts.
 */
export async function applyMaterialKit(ctx: OrgContext, jobId: string) {
	const [j] = await db
		.select({ id: job.id, jobTypeId: job.jobTypeId })
		.from(job)
		.where(and(eq(job.organizationId, ctx.orgId), eq(job.id, jobId)));
	if (!j) error(404, 'Job not found');
	const kit = j.jobTypeId
		? await db
				.select({
					inventoryItemId: jobTypeMaterial.inventoryItemId,
					qty: jobTypeMaterial.qty,
					name: inventoryItem.name,
					unitCost: inventoryItem.unitCost
				})
				.from(jobTypeMaterial)
				.innerJoin(inventoryItem, eq(jobTypeMaterial.inventoryItemId, inventoryItem.id))
				.where(
					and(
						eq(jobTypeMaterial.organizationId, ctx.orgId),
						eq(jobTypeMaterial.jobTypeId, j.jobTypeId)
					)
				)
		: [];
	if (!kit.length) error(404, 'This job type has no material kit');
	let applied = 0;
	const skipped: string[] = [];
	for (const line of kit) {
		try {
			await addMaterial(ctx, {
				jobId,
				inventoryItemId: line.inventoryItemId,
				qty: line.qty,
				unitPrice: line.unitCost,
				truckMemberId: null
			});
			applied++;
		} catch {
			skipped.push(line.name);
		}
	}
	return { applied, skipped };
}

// ---------- Purchase orders ----------

/** All POs with their lines, newest first. */
export async function listPurchaseOrders(orgId: string) {
	const pos = await db
		.select({ po: purchaseOrder, jobNumber: job.number })
		.from(purchaseOrder)
		.leftJoin(job, eq(purchaseOrder.jobId, job.id))
		.where(eq(purchaseOrder.organizationId, orgId))
		.orderBy(sql`${purchaseOrder.number} desc`)
		.limit(100);
	if (!pos.length) return [];
	const items = await db
		.select()
		.from(purchaseOrderItem)
		.where(eq(purchaseOrderItem.organizationId, orgId));
	return pos.map(({ po, jobNumber }) => ({
		po,
		jobNumber,
		items: items.filter((i) => i.purchaseOrderId === po.id),
		total: items
			.filter((i) => i.purchaseOrderId === po.id)
			.reduce((s, i) => s + i.qty * i.unitCost, 0)
	}));
}

export async function createPurchaseOrder(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.purchaseOrderInput>
) {
	if (!input.items.length) error(400, 'Add at least one line');
	const [max] = await db
		.select({ n: sql<number>`coalesce(max(${purchaseOrder.number}), 0)`.mapWith(Number) })
		.from(purchaseOrder)
		.where(eq(purchaseOrder.organizationId, ctx.orgId));
	const stock = await db
		.select()
		.from(inventoryItem)
		.where(eq(inventoryItem.organizationId, ctx.orgId));
	const byId = new Map(stock.map((i) => [i.id, i]));
	const [po] = await db
		.insert(purchaseOrder)
		.values({
			organizationId: ctx.orgId,
			number: max.n + 1,
			supplier: input.supplier,
			expectedOn: input.expectedOn || null,
			notes: input.notes,
			jobId: input.jobId ?? null
		})
		.returning();
	await db.insert(purchaseOrderItem).values(
		input.items.map((i) => {
			const item = byId.get(i.inventoryItemId);
			if (!item) error(404, 'Stock item not found');
			return {
				organizationId: ctx.orgId,
				purchaseOrderId: po!.id,
				inventoryItemId: item.id,
				name: item.name,
				unit: item.unit,
				qty: i.qty,
				unitCost: i.unitCost
			};
		})
	);
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'purchase_order',
		entityId: po!.id,
		action: 'created',
		summary: `PO-${po!.number} to ${po!.supplier} (${input.items.length} items)`
	});
	return po;
}

/** Drafts a PO from a job's logged materials — the job page 'Order parts' shortcut.
 * Aggregates qty per stock item and guesses the supplier from the last PO that
 * carried one of them (blank TBD otherwise — the PO stays an editable draft). */
export async function createPoFromJob(ctx: OrgContext, jobId: string) {
	const [j] = await db
		.select({ id: job.id, number: job.number })
		.from(job)
		.where(and(eq(job.organizationId, ctx.orgId), eq(job.id, jobId)));
	if (!j) error(404, 'Job not found');
	const mats = await db
		.select({
			inventoryItemId: jobMaterial.inventoryItemId,
			qty: jobMaterial.qty,
			unitCost: inventoryItem.unitCost
		})
		.from(jobMaterial)
		.innerJoin(inventoryItem, eq(jobMaterial.inventoryItemId, inventoryItem.id))
		.where(eq(jobMaterial.jobId, jobId));
	if (!mats.length) error(409, 'Log materials on the job first — nothing to order');
	const byItem = new Map<string, { qty: number; unitCost: number }>();
	for (const m of mats) {
		const e = byItem.get(m.inventoryItemId) ?? { qty: 0, unitCost: m.unitCost };
		e.qty += m.qty;
		byItem.set(m.inventoryItemId, e);
	}
	const [lastSupplier] = await db
		.select({ supplier: purchaseOrder.supplier })
		.from(purchaseOrderItem)
		.innerJoin(purchaseOrder, eq(purchaseOrderItem.purchaseOrderId, purchaseOrder.id))
		.where(
			and(
				eq(purchaseOrder.organizationId, ctx.orgId),
				inArray(purchaseOrderItem.inventoryItemId, [...byItem.keys()])
			)
		)
		.orderBy(desc(purchaseOrder.createdAt))
		.limit(1);
	return createPurchaseOrder(ctx, {
		supplier: lastSupplier?.supplier || 'TBD',
		expectedOn: '',
		notes: `Parts for J-${j.number}`,
		jobId,
		items: [...byItem].map(([inventoryItemId, e]) => ({
			inventoryItemId,
			qty: e.qty,
			unitCost: e.unitCost
		}))
	});
}

export async function updatePurchaseOrder(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.purchaseOrderUpdate>
) {
	const [po] = await db
		.select()
		.from(purchaseOrder)
		.where(and(eq(purchaseOrder.id, input.id), eq(purchaseOrder.organizationId, ctx.orgId)))
		.limit(1);
	if (!po) error(404, 'Purchase order not found');
	if (po.status !== 'draft') error(409, 'Only draft POs can be edited');
	const { id, ...rest } = input;
	const [row] = await db
		.update(purchaseOrder)
		.set({ ...rest, expectedOn: rest.expectedOn || null, updatedAt: new Date() })
		.where(eq(purchaseOrder.id, id))
		.returning();
	return row;
}

/** draft → ordered stamps it; ordered → received applies qty to stock. Cancel anytime pre-receipt. */
export async function transitionPurchaseOrder(
	ctx: OrgContext,
	id: string,
	to: 'ordered' | 'received' | 'cancelled'
) {
	const [po] = await db
		.select()
		.from(purchaseOrder)
		.where(and(eq(purchaseOrder.id, id), eq(purchaseOrder.organizationId, ctx.orgId)))
		.limit(1);
	if (!po) error(404, 'Purchase order not found');
	const receivedLines: { itemId: string; qty: number }[] = [];
	const ok =
		(po.status === 'draft' && to === 'ordered') ||
		(po.status === 'ordered' && (to === 'received' || to === 'cancelled')) ||
		(po.status === 'draft' && to === 'cancelled');
	if (!ok) error(409, `Can't move a ${po.status} PO to ${to}`);

	await db.transaction(async (tx) => {
		await tx
			.update(purchaseOrder)
			.set({
				status: to,
				orderedAt: to === 'ordered' ? new Date() : po.orderedAt,
				receivedAt: to === 'received' ? new Date() : po.receivedAt,
				updatedAt: new Date()
			})
			.where(eq(purchaseOrder.id, id));
		if (to === 'received') {
			const lines = await tx
				.select()
				.from(purchaseOrderItem)
				.where(eq(purchaseOrderItem.purchaseOrderId, id));
			for (const l of lines) {
				const remaining = l.qty - l.receivedQty;
				if (remaining > 0)
					await tx
						.update(purchaseOrderItem)
						.set({ receivedQty: l.qty })
						.where(eq(purchaseOrderItem.id, l.id));
				if (!l.inventoryItemId || remaining <= 0) continue;
				await tx
					.update(inventoryItem)
					.set({ qtyOnHand: sql`${inventoryItem.qtyOnHand} + ${remaining}` })
					.where(eq(inventoryItem.id, l.inventoryItemId));
				receivedLines.push({ itemId: l.inventoryItemId, qty: remaining });
				void rearmLowStock(ctx.orgId, l.inventoryItemId).catch(() => {});
			}
		}
	});
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'purchase_order',
		entityId: id,
		action: to,
		summary: `PO-${po.number} ${to}`
	});
	for (const l of receivedLines) {
		void emit({
			orgId: ctx.orgId,
			actorId: ctx.userId,
			entityType: 'inventory_item',
			entityId: l.itemId,
			action: 'received',
			summary: `Received ${l.qty} on PO-${po.number}`
		});
	}
	return { id, status: to };
}

/**
 * Receives some units against an ordered PO: per-line qty increments stock, and
 * the PO auto-closes once every line is fully received. A PO can be received in
 * as many deliveries as needed while it stays 'ordered'.
 */
export async function receivePurchaseOrderLines(
	ctx: OrgContext,
	poId: string,
	lines: { itemId: string; qty: number }[]
) {
	if (!lines.length) error(400, 'Nothing to receive');
	const [po] = await db
		.select()
		.from(purchaseOrder)
		.where(and(eq(purchaseOrder.id, poId), eq(purchaseOrder.organizationId, ctx.orgId)))
		.limit(1);
	if (!po) error(404, 'Purchase order not found');
	if (po.status !== 'ordered') error(409, `Can't receive on a ${po.status} PO`);

	const receivedLines: { itemId: string; qty: number }[] = [];
	let closed = false;
	await db.transaction(async (tx) => {
		const rows = await tx
			.select()
			.from(purchaseOrderItem)
			.where(eq(purchaseOrderItem.purchaseOrderId, poId));
		for (const l of lines) {
			const row = rows.find((r) => r.id === l.itemId);
			if (!row) error(404, 'PO line not found');
			const remaining = row.qty - row.receivedQty;
			if (!Number.isInteger(l.qty) || l.qty <= 0 || l.qty > remaining)
				error(409, `Can only receive 1–${remaining} on ${row.name}`);
			row.receivedQty += l.qty;
			await tx
				.update(purchaseOrderItem)
				.set({ receivedQty: row.receivedQty })
				.where(eq(purchaseOrderItem.id, row.id));
			if (row.inventoryItemId) {
				await tx
					.update(inventoryItem)
					.set({ qtyOnHand: sql`${inventoryItem.qtyOnHand} + ${l.qty}` })
					.where(eq(inventoryItem.id, row.inventoryItemId));
				receivedLines.push({ itemId: row.inventoryItemId, qty: l.qty });
			}
		}
		closed = rows.every((r) => r.receivedQty >= r.qty);
		if (closed)
			await tx
				.update(purchaseOrder)
				.set({ status: 'received', receivedAt: new Date(), updatedAt: new Date() })
				.where(eq(purchaseOrder.id, poId));
	});
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'purchase_order',
		entityId: poId,
		action: 'received',
		summary: `PO-${po.number} ${closed ? 'received in full' : 'partially received'}`
	});
	for (const l of receivedLines) {
		void rearmLowStock(ctx.orgId, l.itemId).catch(() => {});
		void emit({
			orgId: ctx.orgId,
			actorId: ctx.userId,
			entityType: 'inventory_item',
			entityId: l.itemId,
			action: 'received',
			summary: `Received ${l.qty} on PO-${po.number}`
		});
	}
	return { id: poId, status: closed ? 'received' : 'ordered' };
}

export async function deletePurchaseOrder(ctx: OrgContext, id: string) {
	const [po] = await db
		.delete(purchaseOrder)
		.where(
			and(
				eq(purchaseOrder.id, id),
				eq(purchaseOrder.organizationId, ctx.orgId),
				eq(purchaseOrder.status, 'draft')
			)
		)
		.returning();
	if (!po) error(409, 'Only draft POs can be deleted');
}

// ---------- Truck stock ----------

/** Every tech's truck load, grouped client-side — rows {stock, itemName, unit, memberName}. */
/** Marks an ordered/received PO's supplier bill paid (or clears it). */
export async function setPurchaseOrderPaid(ctx: OrgContext, id: string, paid: boolean) {
	if (ctx.role === 'member') error(403, 'Admins only');
	const [po] = await db
		.select()
		.from(purchaseOrder)
		.where(and(eq(purchaseOrder.id, id), eq(purchaseOrder.organizationId, ctx.orgId)))
		.limit(1);
	if (!po) error(404, 'Purchase order not found');
	if (po.status !== 'ordered' && po.status !== 'received')
		error(409, 'Only placed or received POs can be marked paid');
	await db
		.update(purchaseOrder)
		.set({ paidAt: paid ? new Date() : null, updatedAt: new Date() })
		.where(eq(purchaseOrder.id, id));
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'purchase_order',
		entityId: id,
		action: paid ? 'paid' : 'unpaid',
		summary: `PO-${po.number} marked ${paid ? 'paid' : 'unpaid'}`
	});
	return { id, paid };
}

export async function listTruckStock(orgId: string) {
	return db
		.select({
			stock: truckStock,
			itemName: inventoryItem.name,
			itemUnit: inventoryItem.unit,
			memberName: user.name
		})
		.from(truckStock)
		.innerJoin(inventoryItem, eq(truckStock.inventoryItemId, inventoryItem.id))
		.innerJoin(member, eq(truckStock.memberId, member.id))
		.innerJoin(user, eq(member.userId, user.id))
		.where(eq(truckStock.organizationId, orgId))
		.orderBy(asc(user.name), asc(inventoryItem.name));
}

/** Move units between the warehouse and a tech's truck. `direction: 'to_truck' | 'to_warehouse'`. */
export async function transferStock(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.truckTransferInput>
) {
	return db.transaction(async (tx) => {
		const [item] = await tx
			.select()
			.from(inventoryItem)
			.where(
				and(
					eq(inventoryItem.id, input.inventoryItemId),
					eq(inventoryItem.organizationId, ctx.orgId)
				)
			)
			.limit(1);
		if (!item) error(404, 'Item not found');
		const [tech] = await tx
			.select({ id: member.id, name: user.name })
			.from(member)
			.innerJoin(user, eq(member.userId, user.id))
			.where(and(eq(member.id, input.memberId), eq(member.organizationId, ctx.orgId)))
			.limit(1);
		if (!tech) error(404, 'Team member not found');
		const [ts] = await tx
			.select()
			.from(truckStock)
			.where(
				and(
					eq(truckStock.memberId, input.memberId),
					eq(truckStock.inventoryItemId, input.inventoryItemId)
				)
			)
			.limit(1);
		if (input.direction === 'to_truck') {
			if (item.qtyOnHand < input.qty)
				error(409, `Only ${item.qtyOnHand} ${item.unit} of ${item.name} on hand`);
			await tx
				.update(inventoryItem)
				.set({ qtyOnHand: sql`${inventoryItem.qtyOnHand} - ${input.qty}` })
				.where(eq(inventoryItem.id, item.id));
			await tx
				.insert(truckStock)
				.values({
					organizationId: ctx.orgId,
					memberId: input.memberId,
					inventoryItemId: input.inventoryItemId,
					qty: input.qty
				})
				.onConflictDoUpdate({
					target: [truckStock.memberId, truckStock.inventoryItemId],
					set: { qty: sql`${truckStock.qty} + ${input.qty}` }
				});
		} else {
			if (!ts || ts.qty < input.qty)
				error(409, `Only ${ts?.qty ?? 0} ${item.unit} of ${item.name} on that truck`);
			await tx
				.update(truckStock)
				.set({ qty: sql`${truckStock.qty} - ${input.qty}` })
				.where(eq(truckStock.id, ts.id));
			await tx
				.update(inventoryItem)
				.set({ qtyOnHand: sql`${inventoryItem.qtyOnHand} + ${input.qty}` })
				.where(eq(inventoryItem.id, item.id));
			void rearmLowStock(ctx.orgId, item.id).catch(() => {});
		}
		void emit({
			orgId: ctx.orgId,
			actorId: ctx.userId,
			entityType: 'inventory_item',
			entityId: item.id,
			action: 'transferred',
			summary: `Moved ${input.qty} × ${item.name} ${input.direction === 'to_truck' ? 'to' : 'from'} ${tech.name}'s truck`
		});
		return { ok: true };
	});
}

/**
 * Daily cron: drafts a restock PO covering every low-stock item that isn't already
 * on an open (draft/ordered) PO. Runs per org; no-op when nothing is short.
 */
export async function runRestock(orgId: string) {
	const low = await db
		.select()
		.from(inventoryItem)
		.where(
			and(
				eq(inventoryItem.organizationId, orgId),
				sql`${inventoryItem.reorderPoint} is not null`,
				sql`${inventoryItem.qtyOnHand} <= ${inventoryItem.reorderPoint}`
			)
		);
	if (!low.length) return;

	// Items already on an open PO don't get re-added.
	const open = await db
		.select({ inventoryItemId: purchaseOrderItem.inventoryItemId })
		.from(purchaseOrderItem)
		.innerJoin(purchaseOrder, eq(purchaseOrderItem.purchaseOrderId, purchaseOrder.id))
		.where(
			and(
				eq(purchaseOrder.organizationId, orgId),
				inArray(purchaseOrder.status, ['draft', 'ordered'])
			)
		);
	const covered = new Set(open.map((r) => r.inventoryItemId));
	const need = low.filter((i) => !covered.has(i.id));
	if (!need.length) return;

	const [max] = await db
		.select({ n: sql<number>`coalesce(max(${purchaseOrder.number}), 0)`.mapWith(Number) })
		.from(purchaseOrder)
		.where(eq(purchaseOrder.organizationId, orgId));
	const [po] = await db
		.insert(purchaseOrder)
		.values({
			organizationId: orgId,
			number: max.n + 1,
			supplier: 'Auto-draft — pick a supplier',
			notes: 'Auto-drafted by the daily restock check'
		})
		.returning();
	await db.insert(purchaseOrderItem).values(
		need.map((i) => ({
			organizationId: orgId,
			purchaseOrderId: po!.id,
			inventoryItemId: i.id,
			name: i.name,
			unit: i.unit,
			qty: Math.max(1, (i.parLevel ?? i.reorderPoint! * 2) - i.qtyOnHand),
			unitCost: i.unitCost
		}))
	);
	void emit({
		orgId,
		actorId: null,
		entityType: 'purchase_order',
		entityId: po!.id,
		action: 'auto_drafted',
		summary: `Restock check drafted PO-${po!.number} (${need.length} low items)`
	});
}
