import { error } from '@sveltejs/kit';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	inventoryItem,
	jobMaterial,
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
		.select()
		.from(inventoryItem)
		.where(eq(inventoryItem.organizationId, orgId))
		.orderBy(asc(inventoryItem.name));
	return rows.map((i) => ({
		item: i,
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

// ---------- Purchase orders ----------

/** All POs with their lines, newest first. */
export async function listPurchaseOrders(orgId: string) {
	const pos = await db
		.select()
		.from(purchaseOrder)
		.where(eq(purchaseOrder.organizationId, orgId))
		.orderBy(sql`${purchaseOrder.number} desc`)
		.limit(100);
	if (!pos.length) return [];
	const items = await db
		.select()
		.from(purchaseOrderItem)
		.where(eq(purchaseOrderItem.organizationId, orgId));
	return pos.map((po) => ({
		po,
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
			notes: input.notes
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
				if (!l.inventoryItemId) continue;
				await tx
					.update(inventoryItem)
					.set({ qtyOnHand: sql`${inventoryItem.qtyOnHand} + ${l.qty}` })
					.where(eq(inventoryItem.id, l.inventoryItemId));
				receivedLines.push({ itemId: l.inventoryItemId, qty: l.qty });
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
