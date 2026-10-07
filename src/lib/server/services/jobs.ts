import { error } from '@sveltejs/kit';
import { and, asc, desc, eq, getTableColumns, gte, isNull, lt, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	charge,
	customer,
	job,
	jobEvent,
	jobTimeEntry,
	jobType,
	member,
	office,
	payment,
	serviceLocation,
	user,
	outer
} from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import { emit } from './events.ts';
import { nextNumber } from './settings.ts';
import { addDays, zonedToUtc } from '#lib/tz.ts';
import type * as s from '#lib/schemas.ts';
import type * as v from 'valibot';

// ---------- Job types ----------

export async function listJobTypes(orgId: string) {
	return db
		.select({
			...getTableColumns(jobType),
			officeName: office.name,
			technicianName: user.name
		})
		.from(jobType)
		.leftJoin(office, eq(jobType.officeId, office.id))
		.leftJoin(member, eq(jobType.technicianId, member.id))
		.leftJoin(user, eq(member.userId, user.id))
		.where(eq(jobType.organizationId, orgId))
		.orderBy(asc(jobType.name));
}

export async function createJobType(ctx: OrgContext, input: v.InferOutput<typeof s.jobTypeInput>) {
	const [row] = await db
		.insert(jobType)
		.values({
			organizationId: ctx.orgId,
			name: input.name,
			description: input.description,
			color: input.color,
			durationMin: input.durationMin,
			defaultAmount: input.defaultAmount ?? null,
			officeId: input.officeId ?? null,
			technicianId: input.technicianId ?? null,
			active: input.active
		})
		.returning();
	return row;
}

export async function updateJobType(ctx: OrgContext, input: v.InferOutput<typeof s.jobTypeUpdate>) {
	const { id, ...set } = input;
	const [row] = await db
		.update(jobType)
		.set(set)
		.where(and(eq(jobType.organizationId, ctx.orgId), eq(jobType.id, id)))
		.returning();
	if (!row) error(404, 'Job type not found');
	return row;
}

// ---------- Jobs ----------

const jobSelect = {
	job,
	jobTypeName: jobType.name,
	color: jobType.color,
	customerName: customer.name,
	companyName: customer.companyName,
	technicianName: user.name,
	locationLabel: serviceLocation.label,
	address1: serviceLocation.address1,
	city: serviceLocation.city,
	state: serviceLocation.state
};

export async function listJobs(
	orgId: string,
	opts: {
		from?: Date;
		to?: Date;
		status?: string[];
		technicianId?: string;
		unscheduled?: boolean;
	}
) {
	return db
		.select(jobSelect)
		.from(job)
		.leftJoin(jobType, eq(job.jobTypeId, jobType.id))
		.innerJoin(customer, eq(job.customerId, customer.id))
		.leftJoin(serviceLocation, eq(job.serviceLocationId, serviceLocation.id))
		.leftJoin(member, eq(job.technicianId, member.id))
		.leftJoin(user, eq(member.userId, user.id))
		.where(
			and(
				eq(job.organizationId, orgId),
				opts.from ? gte(job.startsAt, opts.from) : undefined,
				opts.to ? lt(job.startsAt, opts.to) : undefined,
				opts.unscheduled ? eq(job.status, 'unscheduled') : undefined,
				opts.status?.length
					? sql`${outer(job.status)} in (${sql.join(
							opts.status.map((x) => sql`${x}`),
							sql`, `
						)})`
					: undefined,
				opts.technicianId ? eq(job.technicianId, opts.technicianId) : undefined
			)
		)
		.orderBy(asc(job.startsAt), asc(job.number));
}

export async function getJob(orgId: string, id: string) {
	const [row] = await db
		.select({ ...jobSelect, officeName: office.name })
		.from(job)
		.leftJoin(jobType, eq(job.jobTypeId, jobType.id))
		.innerJoin(customer, eq(job.customerId, customer.id))
		.leftJoin(serviceLocation, eq(job.serviceLocationId, serviceLocation.id))
		.leftJoin(office, eq(job.officeId, office.id))
		.leftJoin(member, eq(job.technicianId, member.id))
		.leftJoin(user, eq(member.userId, user.id))
		.where(and(eq(job.organizationId, orgId), eq(job.id, id)));
	if (!row) error(404, 'Job not found');

	const events = await db
		.select({ event: jobEvent, memberName: user.name })
		.from(jobEvent)
		.leftJoin(member, eq(jobEvent.memberId, member.id))
		.leftJoin(user, eq(member.userId, user.id))
		.where(eq(jobEvent.jobId, id))
		.orderBy(asc(jobEvent.at));

	const [{ open }] = await db
		.select({
			open: sql<number>`coalesce(sum(${charge.amount} - coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${outer(charge.id)}), 0)), 0)`.mapWith(
				Number
			)
		})
		.from(charge)
		.where(and(eq(charge.jobId, id), sql`${charge.status} != 'void'`));

	return { ...row, events, openBalance: open };
}

/** Creates a job. `startsAt` is a wall-clock time in the workspace timezone; omit for unscheduled. */
export async function createJob(
	ctx: { orgId: string; userId?: string | null },
	tz: string,
	input: v.InferOutput<typeof s.jobInput>,
	opts: { source?: (typeof job.$inferInsert)['source']; number?: number } = {}
) {
	const [c] = await db
		.select()
		.from(customer)
		.where(and(eq(customer.organizationId, ctx.orgId), eq(customer.id, input.customerId)));
	if (!c) error(404, 'Customer not found');

	const jt = input.jobTypeId
		? (
				await db
					.select()
					.from(jobType)
					.where(and(eq(jobType.organizationId, ctx.orgId), eq(jobType.id, input.jobTypeId)))
			)[0]
		: null;
	if (input.jobTypeId && !jt) error(404, 'Job type not found');

	const number = opts.number ?? (await nextNumber(ctx.orgId, 'job'));
	const start = input.startsAt ? zonedToUtc(input.startsAt, tz) : null;
	const durationMin = jt?.durationMin ?? 60;
	const [row] = await db
		.insert(job)
		.values({
			organizationId: ctx.orgId,
			number,
			jobTypeId: input.jobTypeId ?? null,
			customerId: input.customerId,
			serviceLocationId: input.serviceLocationId ?? null,
			officeId: input.officeId ?? jt?.officeId ?? null,
			technicianId: input.technicianId ?? jt?.technicianId ?? null,
			summary: input.summary || jt?.name || '',
			description: input.description,
			priority: input.priority,
			source: opts.source ?? 'manual',
			status: start ? 'scheduled' : 'unscheduled',
			startsAt: start,
			endsAt: start ? new Date(start.getTime() + durationMin * 60_000) : null
		})
		.returning();
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'job',
		entityId: row!.id,
		action: 'created',
		summary: `Job J-${number}: ${row!.summary || jt?.name || c.name}`
	});
	return row;
}

export async function updateJob(
	ctx: OrgContext,
	tz: string,
	input: v.InferOutput<typeof s.jobUpdate>
) {
	const { id, ...set } = input;
	const [existing] = await db
		.select()
		.from(job)
		.where(and(eq(job.organizationId, ctx.orgId), eq(job.id, id)));
	if (!existing) error(404, 'Job not found');
	if (existing.status === 'done') error(409, 'Job is done — edit is locked');

	const start =
		set.startsAt === undefined
			? undefined
			: set.startsAt === null
				? null
				: zonedToUtc(set.startsAt, tz);
	// Duration: explicit, else keep the existing window, else 60 minutes.
	const durationMin =
		set.durationMin ??
		(existing.startsAt && existing.endsAt
			? Math.round((existing.endsAt.getTime() - existing.startsAt.getTime()) / 60_000)
			: 60);
	const endsAt =
		start === undefined
			? set.durationMin !== undefined && existing.startsAt
				? new Date(existing.startsAt.getTime() + durationMin * 60_000)
				: undefined
			: start === null
				? null
				: new Date(start.getTime() + durationMin * 60_000);

	const status =
		set.cancelled === true
			? 'cancelled'
			: set.cancelled === false
				? (start ?? existing.startsAt)
					? 'scheduled'
					: 'unscheduled'
				: start === null
					? 'unscheduled'
					: start !== undefined && existing.status === 'unscheduled'
						? 'scheduled'
						: undefined;

	const [row] = await db
		.update(job)
		.set({
			jobTypeId: set.jobTypeId,
			serviceLocationId: set.serviceLocationId,
			officeId: set.officeId,
			technicianId: set.technicianId,
			summary: set.summary,
			description: set.description,
			priority: set.priority,
			startsAt: start,
			endsAt,
			status,
			cancelledAt: set.cancelled === undefined ? undefined : set.cancelled ? new Date() : null
		})
		.where(and(eq(job.organizationId, ctx.orgId), eq(job.id, id)))
		.returning();
	if (set.cancelled === true) await stopOpenTimers(ctx.orgId, id);
	return row;
}

// ---------- Status events (dispatch trail) ----------

const STATUS_FOR_EVENT = {
	dispatched: 'dispatched',
	en_route: 'dispatched',
	on_site: 'in_progress',
	completed: 'done'
} as const;

/** Records a status ping and moves the job along the dispatch flow. */
export async function recordJobEvent(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.jobEventInput>
) {
	const [j] = await db
		.select()
		.from(job)
		.where(and(eq(job.organizationId, ctx.orgId), eq(job.id, input.jobId)));
	if (!j) error(404, 'Job not found');
	if (j.status === 'done' || j.status === 'cancelled') error(409, `Job is ${j.status}`);

	const [memberRow] = await db
		.select({ id: member.id })
		.from(member)
		.where(and(eq(member.organizationId, ctx.orgId), eq(member.userId, ctx.userId)));

	const [row] = await db
		.insert(jobEvent)
		.values({
			organizationId: ctx.orgId,
			jobId: input.jobId,
			kind: input.kind,
			memberId: memberRow?.id ?? null,
			note: input.note ?? null
		})
		.returning();

	const status = STATUS_FOR_EVENT[input.kind as keyof typeof STATUS_FOR_EVENT];
	if (status) {
		await db
			.update(job)
			.set({
				status,
				completedAt: status === 'done' ? new Date() : undefined
			})
			.where(eq(job.id, input.jobId));
	}
	if (input.kind === 'on_site' && memberRow?.id)
		await startTimerFor(ctx.orgId, input.jobId, memberRow.id, ctx.userId);
	if (input.kind === 'completed') await stopOpenTimers(ctx.orgId, input.jobId);
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'job',
		entityId: input.jobId,
		action: input.kind,
		summary: `J-${j.number} ${input.kind.replace('_', ' ')}${input.note ? ` — ${input.note}` : ''}`,
		data: { kind: input.kind }
	});
	return row;
}

// ---------- Time tracking ----------

const memberFor = async (ctx: OrgContext) =>
	(
		await db
			.select({ id: member.id, name: user.name })
			.from(member)
			.innerJoin(user, eq(member.userId, user.id))
			.where(and(eq(member.organizationId, ctx.orgId), eq(member.userId, ctx.userId)))
	)[0];

const requireJob = async (orgId: string, jobId: string) => {
	const [j] = await db
		.select()
		.from(job)
		.where(and(eq(job.organizationId, orgId), eq(job.id, jobId)));
	if (!j) error(404, 'Job not found');
	return j;
};

/** Entries for a job, newest first, plus the caller's own open entry if they have one. */
export async function listTimeEntries(ctx: OrgContext, jobId: string) {
	await requireJob(ctx.orgId, jobId);
	const entries = await db
		.select({ entry: jobTimeEntry, memberName: user.name })
		.from(jobTimeEntry)
		.leftJoin(member, eq(jobTimeEntry.memberId, member.id))
		.leftJoin(user, eq(member.userId, user.id))
		.where(eq(jobTimeEntry.jobId, jobId))
		.orderBy(desc(jobTimeEntry.startedAt));
	const me = await memberFor(ctx);
	return {
		entries,
		mine: entries.find((e) => !e.entry.endedAt && e.entry.memberId === me?.id)?.entry ?? null,
		myMemberId: me?.id ?? null,
		isAdmin: ctx.role !== 'member'
	};
}

/**
 * Opens a time entry for `memberId` on `jobId`, clocking the member out of any other job first.
 * Idempotent: an already-open entry on the same job is returned as-is.
 */
async function startTimerFor(
	orgId: string,
	jobId: string,
	memberId: string,
	actorId?: string | null
) {
	const [open] = await db
		.select()
		.from(jobTimeEntry)
		.where(
			and(
				eq(jobTimeEntry.organizationId, orgId),
				eq(jobTimeEntry.memberId, memberId),
				isNull(jobTimeEntry.endedAt)
			)
		);
	if (open?.jobId === jobId) return open;
	if (open)
		await db.update(jobTimeEntry).set({ endedAt: new Date() }).where(eq(jobTimeEntry.id, open.id));
	const [row] = await db
		.insert(jobTimeEntry)
		.values({ organizationId: orgId, jobId, memberId, startedAt: new Date() })
		.returning();
	const [j] = await db.select({ number: job.number }).from(job).where(eq(job.id, jobId));
	await emit({
		orgId,
		actorId,
		entityType: 'job',
		entityId: jobId,
		action: 'clocked_in',
		summary: `Clocked in on J-${j?.number}`
	});
	return row;
}

/** Clocks in the calling staff member on a job. */
export async function startTimer(ctx: OrgContext, jobId: string) {
	const j = await requireJob(ctx.orgId, jobId);
	if (j.status === 'done' || j.status === 'cancelled') error(409, `Job is ${j.status}`);
	const me = await memberFor(ctx);
	if (!me) error(403, 'Only staff members can track time');
	return startTimerFor(ctx.orgId, jobId, me.id, ctx.userId);
}

/** Closes the caller's open entry on the job; returns the closed entry, or null if none. */
export async function stopTimer(ctx: OrgContext, jobId: string) {
	await requireJob(ctx.orgId, jobId);
	const me = await memberFor(ctx);
	if (!me) error(403, 'Only staff members can track time');
	const [row] = await db
		.update(jobTimeEntry)
		.set({ endedAt: new Date() })
		.where(
			and(
				eq(jobTimeEntry.organizationId, ctx.orgId),
				eq(jobTimeEntry.jobId, jobId),
				eq(jobTimeEntry.memberId, me.id),
				isNull(jobTimeEntry.endedAt)
			)
		)
		.returning();
	return row ?? null;
}

/** Clocks out everyone still open on the job (completion, cancellation). */
async function stopOpenTimers(orgId: string, jobId: string) {
	await db
		.update(jobTimeEntry)
		.set({ endedAt: new Date() })
		.where(
			and(
				eq(jobTimeEntry.organizationId, orgId),
				eq(jobTimeEntry.jobId, jobId),
				isNull(jobTimeEntry.endedAt)
			)
		);
}

/** Manually logged time. Members log for themselves; admin/owner can log for anyone. */
export async function addTimeEntry(
	ctx: OrgContext,
	tz: string,
	input: v.InferOutput<typeof s.timeEntryInput>
) {
	const j = await requireJob(ctx.orgId, input.jobId);
	if (j.status === 'cancelled') error(409, 'Job is cancelled');
	const me = await memberFor(ctx);
	const memberId = input.memberId ?? me?.id;
	if (!memberId) error(400, 'Pick a member');
	if (memberId !== me?.id && ctx.role === 'member') error(403, 'Admins only');
	const [target] = await db
		.select({ id: member.id })
		.from(member)
		.where(and(eq(member.organizationId, ctx.orgId), eq(member.id, memberId)));
	if (!target) error(404, 'Member not found');

	const startedAt = zonedToUtc(input.startedAt, tz);
	const endedAt = input.endedAt ? zonedToUtc(input.endedAt, tz) : null;
	if (endedAt && endedAt <= startedAt) error(400, 'End must be after start');

	const [row] = await db
		.insert(jobTimeEntry)
		.values({
			organizationId: ctx.orgId,
			jobId: input.jobId,
			memberId,
			startedAt,
			endedAt,
			note: input.note ?? ''
		})
		.returning();
	return row;
}

/** Deletes an entry. Members can delete their own; admin/owner can delete anyone's. */
export async function deleteTimeEntry(ctx: OrgContext, entryId: string) {
	const [row] = await db
		.select()
		.from(jobTimeEntry)
		.where(and(eq(jobTimeEntry.organizationId, ctx.orgId), eq(jobTimeEntry.id, entryId)));
	if (!row) error(404, 'Entry not found');
	const me = await memberFor(ctx);
	if (row.memberId !== me?.id && ctx.role === 'member') error(403, 'Admins only');
	await db.delete(jobTimeEntry).where(eq(jobTimeEntry.id, row.id));
}

// ---------- Dispatch board ----------

/** Jobs in the window plus everything unscheduled — one payload for the dispatch board. */
export async function dispatchBoard(orgId: string, from: Date, to: Date) {
	const [scheduled, unscheduled, technicians] = await Promise.all([
		listJobs(orgId, { from, to }),
		listJobs(orgId, { unscheduled: true }),
		listTechnicians(orgId)
	]);
	return { scheduled, unscheduled, technicians };
}

/** Technicians = staff members of the org. */
export async function listTechnicians(orgId: string) {
	return db
		.select({ id: member.id, name: user.name })
		.from(member)
		.innerJoin(user, eq(member.userId, user.id))
		.where(eq(member.organizationId, orgId))
		.orderBy(asc(user.name));
}

/** A technician's day: their jobs in the window, soonest first. */
export async function techDay(orgId: string, memberId: string, from: Date, to: Date) {
	return listJobs(orgId, { from, to, technicianId: memberId });
}

export { addDays };
