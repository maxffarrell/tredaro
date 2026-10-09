import * as v from 'valibot';
import { command, query } from '$app/server';
import { requireOrg } from '#lib/server/context.ts';
import * as svc from '#lib/server/services/inventory.ts';
import * as eventsSvc from '#lib/server/services/events.ts';
import {
	idSchema,
	inventoryAdjustInput,
	inventoryItemInput,
	inventoryItemUpdate,
	jobMaterialInput,
	truckTransferInput,
	purchaseOrderInput,
	purchaseOrderUpdate
} from '#lib/schemas.ts';
import { refreshQuery } from './_refresh.ts';
import { getDashboard } from './workspace.remote.ts';
import { getJob } from './jobs.remote.ts';

export const getInventory = query(async () => svc.listItems((await requireOrg()).orgId));

/** Per-item movement history — the activity feed scoped to one inventory item. */
export const getItemHistory = query(idSchema, async (itemId) => {
	const { orgId } = await requireOrg();
	return eventsSvc.listActivity(orgId, 'inventory_item', itemId);
});

export const createInventoryItem = command(inventoryItemInput, async (input) => {
	const i = await svc.createItem(await requireOrg('admin'), input);
	await refreshQuery(getInventory, undefined);
	void getDashboard().refresh();
	return i;
});

export const updateInventoryItem = command(inventoryItemUpdate, async (input) => {
	const i = await svc.updateItem(await requireOrg('admin'), input);
	await refreshQuery(getInventory, undefined);
	await refreshQuery(getItemHistory, input.id);
	void getDashboard().refresh();
	return i;
});

const adjustInput = v.object({
	...inventoryAdjustInput.entries,
	direction: v.picklist(['in', 'out'])
});
export const adjustInventoryQty = command(adjustInput, async (input) => {
	const i = await svc.adjustQty(await requireOrg('admin'), input);
	await refreshQuery(getInventory, undefined);
	await refreshQuery(getItemHistory, input.id);
	void getDashboard().refresh();
	return i;
});

export const deleteInventoryItem = command(idSchema, async (id) => {
	await svc.deleteItem(await requireOrg('admin'), id);
	await refreshQuery(getInventory, undefined);
	await refreshQuery(getItemHistory, id);
	void getDashboard().refresh();
	return { id };
});

export const getJobMaterials = query(v.object({ jobId: idSchema }), async ({ jobId }) =>
	svc.listJobMaterials((await requireOrg()).orgId, jobId)
);

export const addJobMaterial = command(jobMaterialInput, async (input) => {
	const m = await svc.addMaterial(await requireOrg(), input);
	await refreshQuery(getJobMaterials, { jobId: input.jobId });
	await refreshQuery(getJob, input.jobId);
	await refreshQuery(getInventory, undefined);
	await refreshQuery(getItemHistory, input.inventoryItemId);
	void getDashboard().refresh();
	return m;
});

export const removeJobMaterial = command(idSchema, async (materialId) => {
	const m = await svc.removeMaterial(await requireOrg(), materialId);
	await refreshQuery(getJobMaterials, { jobId: m.jobId });
	await refreshQuery(getJob, m.jobId);
	await refreshQuery(getInventory, undefined);
	await refreshQuery(getItemHistory, m.inventoryItemId);
	void getDashboard().refresh();
	return m;
});

// ---------- Purchase orders ----------

export const getPurchaseOrders = query(async () =>
	svc.listPurchaseOrders((await requireOrg()).orgId)
);

export const createPurchaseOrder = command(purchaseOrderInput, async (input) => {
	const po = await svc.createPurchaseOrder(await requireOrg('admin'), input);
	await refreshQuery(getPurchaseOrders, undefined);
	return po;
});

export const updatePurchaseOrder = command(purchaseOrderUpdate, async (input) => {
	const po = await svc.updatePurchaseOrder(await requireOrg('admin'), input);
	await refreshQuery(getPurchaseOrders, undefined);
	return po;
});

/** Drafts a PO from a job's logged materials — the job page 'Order parts' shortcut. */
export const createPoFromJob = command(idSchema, async (jobId) => {
	const po = await svc.createPoFromJob(await requireOrg('admin'), jobId);
	await refreshQuery(getPurchaseOrders, undefined);
	return po;
});

const poTransition = v.object({
	id: idSchema,
	to: v.picklist(['ordered', 'received', 'cancelled'])
});
const poReceive = v.object({
	id: idSchema,
	lines: v.array(
		v.object({ itemId: idSchema, qty: v.pipe(v.number(), v.integer(), v.minValue(1)) })
	)
});

/** Receive some/all units on an ordered PO — stock updates, PO closes when complete. */
export const receivePurchaseOrder = command(poReceive, async (input) => {
	const r = await svc.receivePurchaseOrderLines(await requireOrg('admin'), input.id, input.lines);
	await refreshQuery(getPurchaseOrders, undefined);
	await refreshQuery(getInventory, undefined);
	await refreshQuery(getDashboard, undefined);
	return r;
});

export const transitionPurchaseOrder = command(poTransition, async (input) => {
	const r = await svc.transitionPurchaseOrder(await requireOrg('admin'), input.id, input.to);
	await refreshQuery(getPurchaseOrders, undefined);
	await refreshQuery(getInventory, undefined);
	await refreshQuery(getDashboard, undefined);
	return r;
});

export const deletePurchaseOrder = command(idSchema, async (id) => {
	await svc.deletePurchaseOrder(await requireOrg('admin'), id);
	await refreshQuery(getPurchaseOrders, undefined);
	return { id };
});

// ---------- Truck stock ----------

export const getTruckStock = query(async () => svc.listTruckStock((await requireOrg()).orgId));

export const transferTruckStock = command(truckTransferInput, async (input) => {
	const r = await svc.transferStock(await requireOrg('admin'), input);
	await refreshQuery(getTruckStock, undefined);
	await refreshQuery(getInventory, undefined);
	await refreshQuery(getItemHistory, input.inventoryItemId);
	void getDashboard().refresh();
	return r;
});
