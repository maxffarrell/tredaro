import * as v from 'valibot';
import { command, query } from '$app/server';
import { refreshQuery } from './_refresh.ts';
import { requireOrg } from '#lib/server/context.ts';
import * as svc from '#lib/server/services/jobs.ts';
import { notifyJobScheduled } from '#lib/server/services/notifications.ts';
import { getSettings } from '#lib/server/services/settings.ts';
import { getCustomer } from './customers.remote.ts';
import {
	idSchema,
	jobEventInput,
	jobInput,
	jobTypeInput,
	jobTypeUpdate,
	jobUpdate,
	timeEntryInput
} from '#lib/schemas.ts';

const tz = async () => {
	const { orgId } = await requireOrg();
	return (await getSettings(orgId)).timezone;
};

export const getJobTypes = query(async () => svc.listJobTypes((await requireOrg()).orgId));
export const createJobType = command(jobTypeInput, async (input) => {
	const t = await svc.createJobType(await requireOrg('admin'), input);
	refreshQuery(getJobTypes, undefined);
	return t;
});
export const updateJobType = command(jobTypeUpdate, async (input) => {
	const t = await svc.updateJobType(await requireOrg('admin'), input);
	refreshQuery(getJobTypes, undefined);
	return t;
});

/** Jobs within `[from, to]` ISO dates; no date filter when omitted (includes unscheduled). */
export const getJobs = query(
	v.optional(
		v.object({
			from: v.optional(v.string()),
			to: v.optional(v.string()),
			status: v.optional(v.array(v.string())),
			technicianId: v.optional(v.string())
		})
	),
	async (opts) => {
		const { orgId } = await requireOrg();
		return svc.listJobs(orgId, {
			from: opts?.from ? new Date(`${opts.from}T00:00:00Z`) : undefined,
			to: opts?.to ? new Date(`${opts.to}T00:00:00Z`) : undefined,
			status: opts?.status,
			technicianId: opts?.technicianId
		});
	}
);
export const getJob = query(idSchema, async (id) => svc.getJob((await requireOrg()).orgId, id));

/** Dispatch board payload for `[from, to]`: scheduled jobs, unscheduled queue, technicians. */
export const getDispatchBoard = query(
	v.optional(v.object({ from: v.optional(v.string()), to: v.optional(v.string()) })),
	async (opts) => {
		const { orgId } = await requireOrg();
		const from = opts?.from ? new Date(`${opts.from}T00:00:00Z`) : new Date();
		const to = opts?.to
			? new Date(`${opts.to}T00:00:00Z`)
			: new Date(from.getTime() + 7 * 86400_000);
		return svc.dispatchBoard(orgId, from, to);
	}
);

export const getTechnicians = query(async () => svc.listTechnicians((await requireOrg()).orgId));

export const createJob = command(jobInput, async (input) => {
	const ctx = await requireOrg();
	const j = await svc.createJob(ctx, await tz(), input);
	if (j?.startsAt)
		void notifyJobScheduled(ctx.orgId, j.id).catch((err) =>
			console.error('job scheduled email failed', err)
		);
	refreshQuery(getJobs, undefined);
	refreshQuery(getDispatchBoard, undefined);
	void getCustomer(input.customerId).refresh();
	return j;
});
export const updateJob = command(jobUpdate, async (input) => {
	const ctx = await requireOrg();
	const j = await svc.updateJob(ctx, await tz(), input);
	// Deduped per job+recipient in notification_log — reschedules don't re-send.
	if (j?.startsAt && j.status === 'scheduled')
		void notifyJobScheduled(ctx.orgId, j.id).catch((err) =>
			console.error('job scheduled email failed', err)
		);
	refreshQuery(getJobs, undefined);
	refreshQuery(getDispatchBoard, undefined);
	refreshQuery(getJob, j!.id);
	void getCustomer(j!.customerId).refresh();
	return j;
});
export const recordJobEvent = command(jobEventInput, async (input) => {
	const e = await svc.recordJobEvent(await requireOrg(), input);
	refreshQuery(getJobs, undefined);
	refreshQuery(getDispatchBoard, undefined);
	refreshQuery(getJob, input.jobId);
	refreshQuery(getTimeEntries, input.jobId);
	return e;
});

// ---------- Time tracking ----------

export const getTimeEntries = query(idSchema, async (jobId) =>
	svc.listTimeEntries(await requireOrg(), jobId)
);

export const startTimer = command(idSchema, async (jobId) => {
	const t = await svc.startTimer(await requireOrg(), jobId);
	refreshQuery(getTimeEntries, jobId);
	return t;
});

export const stopTimer = command(idSchema, async (jobId) => {
	const t = await svc.stopTimer(await requireOrg(), jobId);
	refreshQuery(getTimeEntries, jobId);
	return t;
});

export const addTimeEntry = command(timeEntryInput, async (input) => {
	const t = await svc.addTimeEntry(await requireOrg(), await tz(), input);
	refreshQuery(getTimeEntries, input.jobId);
	return t;
});

export const deleteTimeEntry = command(
	v.object({ id: idSchema, jobId: idSchema }),
	async ({ id, jobId }) => {
		await svc.deleteTimeEntry(await requireOrg(), id);
		refreshQuery(getTimeEntries, jobId);
	}
);
