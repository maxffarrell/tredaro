import * as v from 'valibot';
import { command, query } from '$app/server';
import { requireOrg } from '#lib/server/context.ts';
import * as svc from '#lib/server/services/inventory.ts';
import {
	idSchema,
	inventoryAdjustInput,
	inventoryItemInput,
	inventoryItemUpdate,
	jobMaterialInput
} from '#lib/schemas.ts';
import { refreshQuery } from './_refresh.ts';
import { getDashboard } from './workspace.remote.ts';

export const getInventory = query(async () => svc.listItems((await requireOrg()).orgId));

export const createInventoryItem = command(inventoryItemInput, async (input) => {
	const i = await svc.createItem(await requireOrg('admin'), input);
	await refreshQuery(getInventory, undefined);
	void getDashboard().refresh();
	return i;
});

export const updateInventoryItem = command(inventoryItemUpdate, async (input) => {
	const i = await svc.updateItem(await requireOrg('admin'), input);
	await refreshQuery(getInventory, undefined);
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
	void getDashboard().refresh();
	return i;
});

export const deleteInventoryItem = command(idSchema, async (id) => {
	await svc.deleteItem(await requireOrg('admin'), id);
	await refreshQuery(getInventory, undefined);
	void getDashboard().refresh();
	return { id };
});

export const getJobMaterials = query(v.object({ jobId: idSchema }), async ({ jobId }) =>
	svc.listJobMaterials((await requireOrg()).orgId, jobId)
);

export const addJobMaterial = command(jobMaterialInput, async (input) => {
	const m = await svc.addMaterial(await requireOrg(), input);
	await refreshQuery(getJobMaterials, { jobId: input.jobId });
	await refreshQuery(getInventory, undefined);
	void getDashboard().refresh();
	return m;
});

export const removeJobMaterial = command(idSchema, async (materialId) => {
	const m = await svc.removeMaterial(await requireOrg(), materialId);
	await refreshQuery(getJobMaterials, { jobId: m.jobId });
	await refreshQuery(getInventory, undefined);
	void getDashboard().refresh();
	return m;
});
