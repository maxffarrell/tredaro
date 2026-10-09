import { command } from '$app/server';
import { refreshQuery } from './_refresh.ts';
import { getDashboard } from './workspace.remote.ts';
import { getDispatchBoard, getJob, getMyDay } from './jobs.remote.ts';
import { getCustomer } from './customers.remote.ts';
import { requireOrg } from '#lib/server/context.ts';
import * as svc from '#lib/server/services/followups.ts';
import { dayNoteInput, followUpInput, idSchema } from '#lib/schemas.ts';
import * as v from 'valibot';

const refreshLinked = async (
	row: { customerId: string | null; jobId: string | null } | undefined | null
) => {
	await refreshQuery(getDashboard, undefined);
	if (row?.customerId) await refreshQuery(getCustomer, row.customerId);
	if (row?.jobId) await refreshQuery(getJob, row.jobId);
};

export const addFollowUp = command(followUpInput, async (input) => {
	const row = await svc.addFollowUp(await requireOrg(), input);
	await refreshLinked(row);
	return row;
});

export const completeFollowUp = command(idSchema, async (id) => {
	const row = await svc.completeFollowUp(await requireOrg(), id);
	await refreshLinked(row);
	return row;
});

export const snoozeFollowUp = command(
	v.object({ id: idSchema, days: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(90)) }),
	async (input) => {
		const row = await svc.snoozeFollowUp(await requireOrg(), input.id, input.days);
		await refreshLinked(row);
		return row;
	}
);

export const removeFollowUp = command(idSchema, async (id) => {
	const row = await svc.removeFollowUp(await requireOrg(), id);
	await refreshLinked(row);
});

export const setDayNote = command(dayNoteInput, async (input) => {
	const row = await svc.setDayNote(await requireOrg(), input);
	await refreshQuery(getDispatchBoard, undefined);
	await refreshQuery(getMyDay, undefined);
	return row;
});
