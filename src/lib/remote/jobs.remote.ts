import * as v from 'valibot';
import { command, query } from '$app/server';
import { requireOrg } from '#lib/server/context.ts';
import * as svc from '#lib/server/services/jobs.ts';
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
	void getJobTypes().refresh();
	return t;
});
export const updateJobType = command(jobTypeUpdate, async (input) => {
	const t = await svc.updateJobType(await requireOrg('admin'), input);
	void getJobTypes().refresh();
	return t;
});

/** Jobs within `[from, to]` ISO dates; defaults to the next 14 days. */
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
		const from = opts?.from ? new Date(`${opts.from}T00:00:00Z`) : new Date();
		const to = opts?.to
			? new Date(`${opts.to}T00:00:00Z`)
			: new Date(from.getTime() + 14 * 86400_000);
		return svc.listJobs(orgId, {
			from,
			to,
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
	const j = await svc.createJob(await requireOrg(), await tz(), input);
	void getJobs().refresh();
	void getDispatchBoard().refresh();
	void getCustomer(input.customerId).refresh();
	return j;
});
export const updateJob = command(jobUpdate, async (input) => {
	const j = await svc.updateJob(await requireOrg(), await tz(), input);
	void getJobs().refresh();
	void getDispatchBoard().refresh();
	void getJob(j!.id).refresh();
	void getCustomer(j!.customerId).refresh();
	return j;
});
export const recordJobEvent = command(jobEventInput, async (input) => {
	const e = await svc.recordJobEvent(await requireOrg(), input);
	void getJobs().refresh();
	void getDispatchBoard().refresh();
	void getJob(input.jobId).refresh();
	void getTimeEntries(input.jobId).refresh();
	return e;
});

// ---------- Time tracking ----------

export const getTimeEntries = query(idSchema, async (jobId) =>
	svc.listTimeEntries(await requireOrg(), jobId)
);

export const startTimer = command(idSchema, async (jobId) => {
	const t = await svc.startTimer(await requireOrg(), jobId);
	void getTimeEntries(jobId).refresh();
	return t;
});

export const stopTimer = command(idSchema, async (jobId) => {
	const t = await svc.stopTimer(await requireOrg(), jobId);
	void getTimeEntries(jobId).refresh();
	return t;
});

export const addTimeEntry = command(timeEntryInput, async (input) => {
	const t = await svc.addTimeEntry(await requireOrg(), await tz(), input);
	void getTimeEntries(input.jobId).refresh();
	return t;
});

export const deleteTimeEntry = command(
	v.object({ id: idSchema, jobId: idSchema }),
	async ({ id, jobId }) => {
		await svc.deleteTimeEntry(await requireOrg(), id);
		void getTimeEntries(jobId).refresh();
	}
);
