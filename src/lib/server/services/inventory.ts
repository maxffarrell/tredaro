import { error } from '@sveltejs/kit';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { inventoryItem, jobMaterial, member, user } from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import { emit } from './events.ts';
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
		if (item.qtyOnHand < input.qty)
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
		const [m] = await tx
			.insert(jobMaterial)
			.values({
				organizationId: ctx.orgId,
				jobId: input.jobId,
				inventoryItemId: input.inventoryItemId,
				qty: input.qty,
				unitPrice: input.unitPrice,
				memberId: me?.id ?? null
			})
			.returning();
		await tx
			.update(inventoryItem)
			.set({ qtyOnHand: sql`${inventoryItem.qtyOnHand} - ${input.qty}` })
			.where(eq(inventoryItem.id, item.id));
		void emit({
			orgId: ctx.orgId,
			actorId: ctx.userId,
			entityType: 'job',
			entityId: input.jobId,
			action: 'material_added',
			summary: `Used ${input.qty} × ${item.name}`
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
		await tx
			.update(inventoryItem)
			.set({ qtyOnHand: sql`${inventoryItem.qtyOnHand} + ${m.qty}` })
			.where(eq(inventoryItem.id, m.inventoryItemId));
		void emit({
			orgId: ctx.orgId,
			actorId: ctx.userId,
			entityType: 'job',
			entityId: m.jobId,
			action: 'material_removed',
			summary: `Returned ${m.qty} × material`
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
