import { error } from '@sveltejs/kit';
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
	notifyTechAssigned,
	notifyServiceReport,
	textJobEta,
	textDayEtas
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
	scheduleVisitsInput,
	timeEntryInput,
	timeOffInput,
	timeOffStatusInput,
	checklistItemInput,
	checklistToggleInput,
	jobSignatureInput,
	jobExpenseInput,
	jobRepeatInput,
	localDateTime,
	optionalText
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
			technicianId: v.optional(v.string()),
			equipmentId: v.optional(v.string()),
			blocked: v.optional(v.boolean())
		})
	),
	async (opts) => {
		const { orgId } = await requireOrg();
		return svc.listJobs(orgId, {
			from: opts?.from ? new Date(`${opts.from}T00:00:00Z`) : undefined,
			to: opts?.to ? new Date(`${opts.to}T00:00:00Z`) : undefined,
			status: opts?.status,
			technicianId: opts?.technicianId,
			equipmentId: opts?.equipmentId,
			blocked: opts?.blocked
		});
	}
);
export const getJobCounts = query(
	v.optional(v.object({ technicianId: v.optional(v.string()) })),
	async (opts) => svc.jobCounts((await requireOrg()).orgId, opts?.technicianId)
);

export const getJob = query(idSchema, async (id) => svc.getJob((await requireOrg()).orgId, id));

export const sendJobEta = command(
	v.object({ jobId: v.string(), minutes: v.number() }),
	async (input) => {
		const ctx = await requireOrg();
		await textJobEta(ctx, input.jobId, input.minutes);
	}
);

/** Texts every customer with a job starting on `day` (YYYY-MM-DD, org timezone) an ETA. */
export const sendDayEtas = command(v.object({ day: v.string() }), async (input) => {
	const ctx = await requireOrg();
	return textDayEtas(ctx, input.day);
});

/** Copies the viewed week's schedule onto the same weekdays next week; conflicts are skipped. */
export const copyWeek = command(v.object({ weekStart: v.string() }), async (input) =>
	svc.copyScheduleWeek(await requireOrg(), input.weekStart)
);
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

/** One member's staff page — profile, 30-day stats, upcoming jobs, recent time, PTO. */
export const getMemberProfile = query(idSchema, async (id) =>
	svc.memberProfile((await requireOrg()).orgId, id)
);

/** Triage a booking waitlist signup on the dispatch board. */
export const updateWaitlistStatus = command(
	v.object({
		id: v.string(),
		status: v.picklist(['new', 'contacted', 'booked', 'closed'])
	}),
	async ({ id, status }) => {
		const row = await svc.setWaitlistStatus((await requireOrg()).orgId, id, status);
		await refreshQuery(getDispatchBoard, undefined);
		return row;
	}
);

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
	if (j?.helperId)
		void notifyTechAssigned(ctx.orgId, j.id, j.helperId).catch((err) =>
			console.error('helper assignment email failed', err)
		);
	await refreshQuery(getJobs, undefined);
	await refreshQuery(getDispatchBoard, undefined);
	await refreshQuery(getDashboard, undefined);
	await refreshQuery(getMyDay, undefined);
	void getCustomer(input.customerId).refresh();
	return j;
});
export const reviewBooking = command(
	v.object({ jobId: v.string(), approve: v.boolean() }),
	async (input) => {
		const ctx = await requireOrg();
		const r = await svc.reviewBooking(ctx, input.jobId, input.approve);
		await refreshQuery(getJobs, undefined);
		await refreshQuery(getDispatchBoard, undefined);
		await refreshQuery(getJob, input.jobId);
		await refreshQuery(getDashboard, undefined);
		return r;
	}
);
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
	if (input.helperId && j?.helperId)
		void notifyTechAssigned(ctx.orgId, j.id, j.helperId).catch((err) =>
			console.error('helper assignment email failed', err)
		);
	await refreshQuery(getJobs, undefined);
	await refreshQuery(getDispatchBoard, undefined);
	await refreshQuery(getJob, j!.id);
	await refreshQuery(getDashboard, undefined);
	await refreshQuery(getMyDay, undefined);
	void getCustomer(j!.customerId).refresh();
	return j;
});

/** Bulk-schedule agreement visits from the customer page — per-job outcome so one
 * conflict doesn't sink the rest. Returns {scheduled, failed:[{jobId,message}]}. */
export const scheduleAgreementVisits = command(scheduleVisitsInput, async (input) => {
	const ctx = await requireOrg();
	const zone = await tz();
	const scheduled: string[] = [];
	const failed: { jobId: string; message: string }[] = [];
	for (const v of input.visits) {
		try {
			const j = await svc.updateJob(ctx, zone, {
				id: v.jobId,
				startsAt: v.startsAt,
				technicianId: v.technicianId ?? undefined
			});
			if (j?.startsAt && j.status === 'scheduled')
				void notifyJobScheduled(ctx.orgId, j.id).catch(() => {});
			if (v.technicianId && j?.technicianId)
				void notifyTechAssigned(ctx.orgId, j.id, j.technicianId).catch(() => {});
			scheduled.push(v.jobId);
		} catch (e) {
			const msg =
				(e as { body?: { message?: string } })?.body?.message ??
				(e instanceof Error ? e.message : String(e));
			failed.push({ jobId: v.jobId, message: msg });
		}
	}
	await refreshQuery(getJobs, undefined);
	await refreshQuery(getDispatchBoard, undefined);
	return { scheduled, failed };
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

/** Tech tells the customer they're running behind — sends an SMS with a new ETA. */
export const textRunningLate = command(
	v.object({
		jobId: idSchema,
		minutes: v.pipe(v.number(), v.integer(), v.minValue(5), v.maxValue(240))
	}),
	async (input) => {
		const r = await svc.runningLate(await requireOrg(), input.jobId, input.minutes);
		await refreshQuery(getJob, input.jobId);
		await refreshQuery(getMyDay, undefined);
		return r;
	}
);

/** Staff answers a portal cancellation request — approve cancels, decline keeps the visit. */
export const resolveVisitCancel = command(
	v.object({ jobId: idSchema, approve: v.boolean() }),
	async (input) => {
		const r = await svc.resolveVisitCancel(await requireOrg(), input.jobId, input.approve);
		await refreshQuery(getJob, input.jobId);
		await refreshQuery(getMyDay, undefined);
		await refreshQuery(getDispatchBoard, undefined);
		return r;
	}
);

export const signJob = command(jobSignatureInput, async (input) => {
	const j = await svc.signJob(await requireOrg(), input);
	await refreshQuery(getJob, input.jobId);
	await refreshQuery(getMyDay, undefined);
	return j;
});

// ---------- Time tracking ----------

export const moveMyDayStop = command(
	v.object({ jobId: idSchema, direction: v.picklist(['up', 'down']) }),
	async (input) => {
		const ctx = await requireOrg();
		const t = await tz();
		const r = await svc.moveMyDayStop(ctx, t, input.jobId, input.direction);
		await refreshQuery(getMyDay, undefined);
		return r;
	}
);

export const getTimeEntries = query(idSchema, async (jobId) =>
	svc.listTimeEntries(await requireOrg(), jobId)
);

const clockInput = v.object({
	jobId: idSchema,
	lat: v.optional(v.pipe(v.number(), v.minValue(-90), v.maxValue(90))),
	lng: v.optional(v.pipe(v.number(), v.minValue(-180), v.maxValue(180)))
});

export const startTimer = command(clockInput, async ({ jobId, lat, lng }) => {
	const t = await svc.startTimer(await requireOrg(), jobId, { lat, lng });
	await refreshQuery(getTimeEntries, jobId);
	await refreshQuery(getJob, jobId);
	await refreshQuery(getMyDay, undefined);
	return t;
});

export const stopTimer = command(clockInput, async ({ jobId, lat, lng }) => {
	const t = await svc.stopTimer(await requireOrg(), jobId, { lat, lng });
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

export const updateTimeEntry = command(
	v.object({
		id: idSchema,
		jobId: idSchema,
		startedAt: localDateTime,
		endedAt: v.optional(v.nullable(localDateTime)),
		note: optionalText,
		breakMin: v.optional(
			v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(720)))
		)
	}),
	async ({ id, ...input }) => {
		await svc.updateTimeEntry(await requireOrg(), await tz(), id, input);
		await refreshQuery(getTimeEntries, input.jobId);
		await refreshQuery(getJob, input.jobId);
		await refreshQuery(getPayroll);
	}
);

export const approveTimeEntry = command(
	v.object({ id: idSchema, approved: v.boolean() }),
	async (input) => {
		const row = await svc.approveTimeEntry(await requireOrg(), input.id, input.approved);
		await refreshQuery(getTimeEntries, row.jobId);
		await refreshQuery(getPayroll);
		return row;
	}
);

export const flagTimeEntry = command(
	v.object({ id: idSchema, note: v.pipe(v.string(), v.trim(), v.maxLength(300)) }),
	async (input) => {
		const row = await svc.flagTimeEntry(await requireOrg(), input.id, input.note);
		await refreshQuery(getTimeEntries, row.jobId);
		await refreshQuery(getPayroll);
		await refreshQuery(getMyDay, undefined);
		return row;
	}
);

export const unflagTimeEntry = command(idSchema, async (entryId) => {
	await svc.unflagTimeEntry(await requireOrg(), entryId);
	await refreshQuery(getPayroll);
	await refreshQuery(getMyDay, undefined);
});

export const approveAllTimeEntries = command(idSchema, async (jobId) => {
	const r = await svc.approveAllTimeEntries(await requireOrg(), jobId);
	await refreshQuery(getTimeEntries, jobId);
	await refreshQuery(getPayroll);
	return r;
});

/** Approve every member's finished entries in the payroll period — the page's 'Approve all'. */
export const approveAllInRange = command(
	v.object({
		from: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)),
		to: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/))
	}),
	async (input) => {
		const ctx = await requireOrg();
		const t = await tz();
		const r = await svc.approveRangeTimeEntries(
			ctx,
			zonedToUtc(`${input.from}T00:00`, t),
			zonedToUtc(`${addDays(input.to, 1)}T00:00`, t)
		);
		await refreshQuery(getPayroll);
		await refreshQuery(getMyDay);
		return r;
	}
);

const payrollRange = v.object({
	from: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)),
	to: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/))
});

/** Closes the payroll period — approves pending entries then locks the range. */
export const closePayrollPeriod = command(payrollRange, async (input) => {
	const ctx = await requireOrg('admin');
	const t = await tz();
	const r = await svc.closePayrollPeriod(
		ctx,
		zonedToUtc(`${input.from}T00:00`, t),
		zonedToUtc(`${addDays(input.to, 1)}T00:00`, t)
	);
	await refreshQuery(getPayroll);
	return r;
});

/** Reopens a closed payroll period — entries can be edited and un-approved again. */
export const reopenPayrollPeriod = command(payrollRange, async (input) => {
	const ctx = await requireOrg('admin');
	const t = await tz();
	const r = await svc.reopenPayrollPeriod(
		ctx,
		zonedToUtc(`${input.from}T00:00`, t),
		zonedToUtc(`${addDays(input.to, 1)}T00:00`, t)
	);
	await refreshQuery(getPayroll);
	return r;
});

export const getPayroll = query(
	v.object({
		from: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)),
		to: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/))
	}),
	async (input) => {
		const ctx = await requireOrg();
		const t = await tz();
		return svc.payrollHours(
			ctx,
			zonedToUtc(`${input.from}T00:00`, t),
			zonedToUtc(`${addDays(input.to, 1)}T00:00`, t)
		);
	}
);

export const approveMemberEntries = command(
	v.object({
		memberId: idSchema,
		from: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)),
		to: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/))
	}),
	async (input) => {
		const ctx = await requireOrg();
		const t = await tz();
		const r = await svc.approveMemberTimeEntries(
			ctx,
			input.memberId,
			zonedToUtc(`${input.from}T00:00`, t),
			zonedToUtc(`${addDays(input.to, 1)}T00:00`, t)
		);
		await refreshQuery(getPayroll);
		return r;
	}
);

export const moveDayStop = command(
	v.object({
		memberId: idSchema,
		on: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)),
		jobId: idSchema,
		direction: v.picklist(['up', 'down'])
	}),
	async (input) => {
		const ctx = await requireOrg();
		const t = await tz();
		const r = await svc.moveDayStop(ctx, t, input.memberId, input.on, input.jobId, input.direction);
		await refreshQuery(getDispatchBoard, undefined);
		await refreshQuery(getMyDay, undefined);
		return r;
	}
);

export const deleteTimeEntry = command(
	v.object({ id: idSchema, jobId: idSchema }),
	async ({ id, jobId }) => {
		await svc.deleteTimeEntry(await requireOrg(), id);
		await refreshQuery(getTimeEntries, jobId);
		await refreshQuery(getJob, jobId);
		await refreshQuery(getPayroll);
	}
);

// ---------- time off ----------

export const getTimeOff = query(async () => svc.listTimeOff((await requireOrg()).orgId));
export const addTimeOff = command(timeOffInput, async (input) => {
	const row = await svc.addTimeOff(await requireOrg('admin'), input);
	await refreshQuery(getTimeOff, undefined);
	return row;
});
const timeOffRequestInput = v.object({
	startsOn: v.pipe(v.string(), v.isoDate('Use YYYY-MM-DD')),
	endsOn: v.pipe(v.string(), v.isoDate('Use YYYY-MM-DD')),
	reason: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200)), '')
});

/** The signed-in tech marks their own time off from My Day. */
export const requestTimeOff = command(timeOffRequestInput, async (input) => {
	const row = await svc.requestTimeOff(await requireOrg(), input);
	await refreshQuery(getTimeOff, undefined);
	await refreshQuery(getMyDay, undefined);
	return row;
});

export const setTimeOffStatus = command(timeOffStatusInput, async (input) => {
	const res = await svc.setTimeOffStatus(await requireOrg('admin'), input.id, input.status);
	await refreshQuery(getTimeOff, undefined);
	await refreshQuery(getDispatchBoard, undefined);
	return res;
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

export const getJobDocuments = query(idSchema, async (jobId) =>
	photosSvc.listJobDocs((await requireOrg()).orgId, jobId)
);

export const removeJobDoc = command(idSchema, async (id) => {
	const row = await photosSvc.deleteJobDoc(await requireOrg(), id);
	void getJobDocuments(row.jobId).refresh();
	return row;
});

export const deleteJobPhoto = command(idSchema, async (id) => {
	const row = await photosSvc.deleteJobPhoto(await requireOrg(), id);
	await refreshQuery(getJobPhotos, row.jobId);
	return { id };
});

/** Share/unshare a job document with the customer on their portal. */
export const setJobDocShared = command(
	v.object({ id: idSchema, shared: v.boolean() }),
	async (input) => {
		const row = await photosSvc.setJobDocShared(await requireOrg(), input.id, input.shared);
		return { id: row.id };
	}
);

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

export const sendServiceReport = command(idSchema, async (id) => {
	const ctx = await requireOrg();
	const j = await svc.getJob(ctx.orgId, id);
	if (j.job.status !== 'done') error(409, 'Complete the job before sending its service report');
	await notifyServiceReport(ctx.orgId, id);
	return { url: svc.serviceReportUrl(id) };
});

/** Converts a waitlist entry into a customer + unscheduled job and marks it booked. */
export const convertWaitlistEntry = command(v.object({ id: v.string() }), async ({ id }) => {
	const ctx = await requireOrg();
	const j = await svc.convertWaitlist(ctx, await tz(), id);
	await refreshQuery(getDispatchBoard, undefined);
	return j;
});
