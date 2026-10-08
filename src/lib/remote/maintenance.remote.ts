import { command, query } from '$app/server';
import { refreshQuery } from './_refresh.ts';
import { requireOrg } from '#lib/server/context.ts';
import * as svc from '#lib/server/services/maintenance.ts';
import { idSchema, scheduleInput, scheduleUpdate } from '#lib/schemas.ts';
import { getCustomer } from './customers.remote.ts';

export const getSchedules = query(idSchema, async (customerId) =>
	svc.listSchedules((await requireOrg()).orgId, customerId)
);

export const createSchedule = command(scheduleInput, async (input) => {
	const row = await svc.createSchedule(await requireOrg(), input);
	await refreshQuery(getSchedules, input.customerId);
	void getCustomer(input.customerId).refresh();
	return row;
});

export const updateSchedule = command(scheduleUpdate, async (input) => {
	const row = await svc.updateSchedule(await requireOrg(), input);
	await refreshQuery(getSchedules, row.customerId);
	return row;
});

export const deleteSchedule = command(idSchema, async (id) => {
	const ctx = await requireOrg();
	const row = await svc.deleteSchedule(ctx, id);
	await refreshQuery(getSchedules, row.customerId);
	return { id };
});
