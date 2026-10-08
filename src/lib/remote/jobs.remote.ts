import * as v from 'valibot';
import { command, query } from '$app/server';
import { refreshQuery } from './_refresh.ts';
import { requireOrg } from '#lib/server/context.ts';
import * as svc from '#lib/server/services/jobs.ts';
import * as photosSvc from '#lib/server/services/photos.ts';
import {
	notifyJobCompleted,
	notifyJobEnRoute,
	notifyJobScheduled,
	notifyPartsDelay,
	notifyTechAssigned
} from '#lib/server/services/notifications.ts';
import { getSettings } from '#lib/server/services/settings.ts';
import { getCustomer } from './customers.remote.ts';
import { getDashboard } from './workspace.remote.ts';
import { addDays, localDate, zonedToUtc } from '#lib/tz.ts';
import {
	idSchema,
	jobEventInput,
	jobInput,
	jobTypeInput,
	jobTypeUpdate,
	jobUpdate,
	timeEntryInput,
	timeOffInput,
	checklistItemInput,
	checklistToggleInput,
	jobSignatureInput,
	jobExpenseInput,
	jobRepeatInput
} from '#lib/schemas.ts';

const tz = async () => {
	const { orgId } = await requireOrg();
	return (await getSettings(orgId)).timezone;
};

export const getJobTypes = query(async () => svc.listJobTypes((await requireOrg()).orgId));
export const createJobType = command(jobTypeInput, async (input) => {
	const t = await svc.createJobType(await requireOrg('admin'), input);
	await refreshQuery(getJobTypes, undefined);
	return t;
});
export const updateJobType = command(jobTypeUpdate, async (input) => {
	const t = await svc.updateJobType(await requireOrg('admin'), input);
	await refreshQuery(getJobTypes, undefined);
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
	v.optional(
		v.object({
			from: v.optional(v.string()),
			to: v.optional(v.string()),
			officeId: v.optional(v.string())
		})
	),
	async (opts) => {
		const { orgId } = await requireOrg();
		const from = opts?.from ? new Date(`${opts.from}T00:00:00Z`) : new Date();
		const to = opts?.to
			? new Date(`${opts.to}T00:00:00Z`)
			: new Date(from.getTime() + 7 * 86400_000);
		return svc.dispatchBoard(orgId, from, to, opts?.officeId || undefined);
	}
);

export const getTechnicians = query(async () => svc.listTechnicians((await requireOrg()).orgId));

/** The calling technician's My Day payload: today's jobs, unscheduled queue, open timer. */
export const getMyDay = query(async () => {
	const ctx = await requireOrg();
	const tz = (await getSettings(ctx.orgId)).timezone;
	const today = localDate(new Date(), tz);
	const day = await svc.myDay(
		ctx,
		zonedToUtc(`${today}T00:00`, tz),
		zonedToUtc(`${addDays(today, 1)}T00:00`, tz)
	);
	return { ...day, tz, today };
});

export const createJob = command(jobInput, async (input) => {
	const ctx = await requireOrg();
	const j = await svc.createJob(ctx, await tz(), input);
	if (j?.startsAt)
		void notifyJobScheduled(ctx.orgId, j.id).catch((err) =>
			console.error('job scheduled email failed', err)
		);
	await refreshQuery(getJobs, undefined);
	await refreshQuery(getDispatchBoard, undefined);
	await refreshQuery(getDashboard, undefined);
	await refreshQuery(getMyDay, undefined);
	void getCustomer(input.customerId).refresh();
	return j;
});
export const markNoShow = command(idSchema, async (jobId) => {
	const ctx = await requireOrg();
	const copy = await svc.markNoShow(ctx, jobId);
	await refreshQuery(getJob, jobId);
	return copy;
});

export const duplicateJob = command(idSchema, async (jobId) => {
	const ctx = await requireOrg();
	const j = await svc.duplicateJob(ctx, jobId);
	await refreshQuery(getJobs, undefined);
	await refreshQuery(getDispatchBoard, undefined);
	await refreshQuery(getDashboard, undefined);
	await refreshQuery(getMyDay, undefined);
	return j;
});
export const repeatJob = command(jobRepeatInput, async (input) => {
	const ctx = await requireOrg();
	const made = await svc.repeatJob(ctx, await tz(), input);
	// One notification per generated scheduled job — same dedupe as single creates.
	for (const j of made)
		if (j.startsAt)
			void notifyJobScheduled(ctx.orgId, j.id).catch((err) =>
				console.error('job scheduled email failed', err)
			);
	await refreshQuery(getJobs, undefined);
	await refreshQuery(getDispatchBoard, undefined);
	await refreshQuery(getDashboard, undefined);
	return made.map((j) => j.id);
});
export const updateJob = command(jobUpdate, async (input) => {
	const ctx = await requireOrg();
	const j = await svc.updateJob(ctx, await tz(), input);
	// Deduped per job+recipient in notification_log — reschedules don't re-send.
	if (j?.startsAt && j.status === 'scheduled')
		void notifyJobScheduled(ctx.orgId, j.id).catch((err) =>
			console.error('job scheduled email failed', err)
		);
	if (input.blocked === true && j?.blocked)
		void notifyPartsDelay(ctx.orgId, j.id).catch((err) =>
			console.error('parts delay notification failed', err)
		);
	if (input.technicianId && j?.technicianId)
		void notifyTechAssigned(ctx.orgId, j.id, j.technicianId).catch((err) =>
			console.error('tech assignment email failed', err)
		);
	await refreshQuery(getJobs, undefined);
	await refreshQuery(getDispatchBoard, undefined);
	await refreshQuery(getJob, j!.id);
	await refreshQuery(getDashboard, undefined);
	await refreshQuery(getMyDay, undefined);
	void getCustomer(j!.customerId).refresh();
	return j;
});
export const recordJobEvent = command(jobEventInput, async (input) => {
	const ctx = await requireOrg();
	const e = await svc.recordJobEvent(ctx, input);
	if (input.kind === 'completed')
		void notifyJobCompleted(ctx.orgId, input.jobId).catch((err) =>
			console.error('job completed notification failed', err)
		);
	if (input.kind === 'en_route')
		void notifyJobEnRoute(ctx.orgId, input.jobId).catch((err) =>
			console.error('en route sms failed', err)
		);
	await refreshQuery(getJobs, undefined);
	await refreshQuery(getDispatchBoard, undefined);
	await refreshQuery(getJob, input.jobId);
	await refreshQuery(getTimeEntries, input.jobId);
	await refreshQuery(getDashboard, undefined);
	await refreshQuery(getMyDay, undefined);
	return e;
});

export const signJob = command(jobSignatureInput, async (input) => {
	const j = await svc.signJob(await requireOrg(), input);
	await refreshQuery(getJob, input.jobId);
	await refreshQuery(getMyDay, undefined);
	return j;
});

// ---------- Time tracking ----------

export const getTimeEntries = query(idSchema, async (jobId) =>
	svc.listTimeEntries(await requireOrg(), jobId)
);

export const startTimer = command(idSchema, async (jobId) => {
	const t = await svc.startTimer(await requireOrg(), jobId);
	await refreshQuery(getTimeEntries, jobId);
	await refreshQuery(getJob, jobId);
	await refreshQuery(getMyDay, undefined);
	return t;
});

export const stopTimer = command(idSchema, async (jobId) => {
	const t = await svc.stopTimer(await requireOrg(), jobId);
	await refreshQuery(getTimeEntries, jobId);
	await refreshQuery(getJob, jobId);
	await refreshQuery(getMyDay, undefined);
	return t;
});

export const addTimeEntry = command(timeEntryInput, async (input) => {
	const t = await svc.addTimeEntry(await requireOrg(), await tz(), input);
	await refreshQuery(getTimeEntries, input.jobId);
	await refreshQuery(getJob, input.jobId);
	return t;
});

export const deleteTimeEntry = command(
	v.object({ id: idSchema, jobId: idSchema }),
	async ({ id, jobId }) => {
		await svc.deleteTimeEntry(await requireOrg(), id);
		await refreshQuery(getTimeEntries, jobId);
		await refreshQuery(getJob, jobId);
	}
);

// ---------- time off ----------

export const getTimeOff = query(async () => svc.listTimeOff((await requireOrg()).orgId));
export const addTimeOff = command(timeOffInput, async (input) => {
	const row = await svc.addTimeOff(await requireOrg('admin'), input);
	await refreshQuery(getTimeOff, undefined);
	return row;
});
export const deleteTimeOff = command(idSchema, async (id) => {
	await svc.deleteTimeOff(await requireOrg('admin'), id);
	await refreshQuery(getTimeOff, undefined);
	return { id };
});

// ---------- checklists ----------

export const getJobChecklist = query(idSchema, async (jobId) =>
	svc.listChecklist((await requireOrg()).orgId, jobId)
);

export const addChecklistItem = command(checklistItemInput, async (input) => {
	const item = await svc.addChecklistItem(await requireOrg(), input);
	await refreshQuery(getJobChecklist, input.jobId);
	await refreshQuery(getJob, input.jobId);
	return item;
});

export const toggleChecklistItem = command(checklistToggleInput, async (input) => {
	const item = await svc.toggleChecklistItem(await requireOrg(), input);
	await refreshQuery(getJobChecklist, item.jobId);
	await refreshQuery(getJob, item.jobId);
	return item;
});

export const deleteChecklistItem = command(idSchema, async (id) => {
	const jobId = await svc.getChecklistJobId((await requireOrg()).orgId, id);
	await svc.deleteChecklistItem(await requireOrg(), id);
	if (jobId) {
		await refreshQuery(getJobChecklist, jobId);
		await refreshQuery(getJob, jobId);
	}
	return { id };
});

// ---------- photos ----------

export const getJobPhotos = query(idSchema, async (jobId) =>
	photosSvc.listJobPhotos((await requireOrg()).orgId, jobId)
);

export const deleteJobPhoto = command(idSchema, async (id) => {
	const row = await photosSvc.deleteJobPhoto(await requireOrg(), id);
	await refreshQuery(getJobPhotos, row.jobId);
	return { id };
});

/** Share/unshare a photo with the customer on their portal. */
export const setJobPhotoShared = command(
	v.object({ id: idSchema, shared: v.boolean() }),
	async (input) => {
		const row = await photosSvc.setJobPhotoShared(await requireOrg(), input.id, input.shared);
		return { id: row.id };
	}
);

// ---------- Job expenses ----------

export const getJobExpenses = query(v.object({ jobId: idSchema }), async ({ jobId }) =>
	svc.listJobExpenses((await requireOrg()).orgId, jobId)
);

export const addJobExpense = command(jobExpenseInput, async (input) => {
	const e = await svc.addJobExpense(await requireOrg(), input);
	await refreshQuery(getJobExpenses, { jobId: input.jobId });
	await refreshQuery(getJob, input.jobId);
	return e;
});

export const removeJobExpense = command(idSchema, async (expenseId) => {
	const e = await svc.removeJobExpense(await requireOrg(), expenseId);
	await refreshQuery(getJobExpenses, { jobId: e.jobId });
	await refreshQuery(getJob, e.jobId);
	return e;
});

export const getCalendarFeed = query(async () => svc.calendarFeed(await requireOrg()));
