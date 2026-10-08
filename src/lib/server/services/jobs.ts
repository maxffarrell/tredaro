import { createHmac } from 'node:crypto';
import { BETTER_AUTH_SECRET } from '$app/env/private';
import { error } from '@sveltejs/kit';
import {
	and,
	asc,
	desc,
	eq,
	getTableColumns,
	gte,
	inArray,
	isNull,
	lt,
	lte,
	sql
} from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	charge,
	customer,
	equipment,
	inventoryItem,
	job,
	jobExpense,
	jobMaterial,
	jobChecklistItem,
	jobEvent,
	jobTimeEntry,
	jobType,
	member,
	memberTimeOff,
	office,
	payment,
	serviceLocation,
	user,
	outer
} from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import { emit } from './events.ts';
import { nextNumber } from './settings.ts';
import { addDays, localDate, localTime, zonedToUtc } from '#lib/tz.ts';
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
			checklist: input.checklist,
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
	equipmentName: equipment.name,
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
		.leftJoin(equipment, eq(job.equipmentId, equipment.id))
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
		.orderBy(
			opts.unscheduled
				? sql`case ${outer(job.priority)} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`
				: asc(job.startsAt),
			asc(job.startsAt),
			asc(job.number)
		);
}

export async function getJob(orgId: string, id: string) {
	const [row] = await db
		.select({ ...jobSelect, officeName: office.name })
		.from(job)
		.leftJoin(jobType, eq(job.jobTypeId, jobType.id))
		.innerJoin(customer, eq(job.customerId, customer.id))
		.leftJoin(serviceLocation, eq(job.serviceLocationId, serviceLocation.id))
		.leftJoin(equipment, eq(job.equipmentId, equipment.id))
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

	const [costing] = await db
		.select({
			laborMin:
				sql<number>`(select coalesce(sum(extract(epoch from (coalesce(te.ended_at, now()) - te.started_at)) / 60), 0) from ${jobTimeEntry} te where te.job_id = ${outer(job.id)})`.mapWith(
					Number
				),
			matCost:
				sql<number>`(select coalesce(sum(m.qty * i.unit_cost), 0) from ${jobMaterial} m inner join ${inventoryItem} i on m.inventory_item_id = i.id where m.job_id = ${outer(job.id)})`.mapWith(
					Number
				),
			matSell:
				sql<number>`(select coalesce(sum(m.qty * m.unit_price), 0) from ${jobMaterial} m where m.job_id = ${outer(job.id)})`.mapWith(
					Number
				),
			billed:
				sql<number>`(select coalesce(sum(c.amount), 0) from ${charge} c where c.job_id = ${outer(job.id)} and c.status != 'void')`.mapWith(
					Number
				),
			expCost:
				sql<number>`(select coalesce(sum(e.amount), 0) from ${jobExpense} e where e.job_id = ${outer(job.id)})`.mapWith(
					Number
				)
		})
		.from(job)
		.where(eq(job.id, id));

	return { ...row, events, openBalance: open, costing };
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
	if (start)
		await assertTechAvailable(
			ctx.orgId,
			input.technicianId ?? jt?.technicianId ?? null,
			start,
			tz,
			new Date(start.getTime() + durationMin * 60_000)
		);
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
			equipmentId: input.equipmentId ?? null,
			summary: input.summary || jt?.name || '',
			description: input.description,
			priority: input.priority,
			preferredTime: input.preferredTime ?? null,
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
	if (jt?.checklist?.length)
		await db.insert(jobChecklistItem).values(
			jt.checklist.map((label, i) => ({
				organizationId: ctx.orgId,
				jobId: row!.id,
				label,
				sort: i
			}))
		);
	return row;
}

// ---------- checklists ----------

export async function listChecklist(orgId: string, jobId: string) {
	return db
		.select()
		.from(jobChecklistItem)
		.where(and(eq(jobChecklistItem.organizationId, orgId), eq(jobChecklistItem.jobId, jobId)))
		.orderBy(asc(jobChecklistItem.sort), asc(jobChecklistItem.createdAt));
}

export async function addChecklistItem(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.checklistItemInput>
) {
	const [j] = await db
		.select({ id: job.id })
		.from(job)
		.where(and(eq(job.id, input.jobId), eq(job.organizationId, ctx.orgId)))
		.limit(1);
	if (!j) error(404, 'Job not found');
	const [max] = await db
		.select({ n: sql<number>`coalesce(max(${jobChecklistItem.sort}), -1)`.mapWith(Number) })
		.from(jobChecklistItem)
		.where(eq(jobChecklistItem.jobId, input.jobId));
	const [item] = await db
		.insert(jobChecklistItem)
		.values({
			organizationId: ctx.orgId,
			jobId: input.jobId,
			label: input.label,
			sort: max.n + 1
		})
		.returning();
	return item;
}

export async function toggleChecklistItem(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.checklistToggleInput>
) {
	const [item] = await db
		.update(jobChecklistItem)
		.set({
			done: input.done,
			doneAt: input.done ? new Date() : null,
			updatedAt: new Date()
		})
		.where(and(eq(jobChecklistItem.id, input.id), eq(jobChecklistItem.organizationId, ctx.orgId)))
		.returning();
	if (!item) error(404, 'Checklist item not found');
	return item;
}

export async function deleteChecklistItem(ctx: OrgContext, id: string) {
	const [item] = await db
		.delete(jobChecklistItem)
		.where(and(eq(jobChecklistItem.id, id), eq(jobChecklistItem.organizationId, ctx.orgId)))
		.returning();
	if (!item) error(404, 'Checklist item not found');
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

	const effectiveStart = start === undefined ? existing.startsAt : start;
	const effectiveTech = set.technicianId === undefined ? existing.technicianId : set.technicianId;
	if (effectiveStart)
		await assertTechAvailable(
			ctx.orgId,
			effectiveTech,
			effectiveStart,
			tz,
			new Date(effectiveStart.getTime() + durationMin * 60_000),
			id
		);

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
			equipmentId: set.equipmentId,
			officeId: set.officeId,
			technicianId: set.technicianId,
			summary: set.summary,
			description: set.description,
			priority: set.priority,
			blocked: set.blocked,
			startsAt: start,
			endsAt,
			status,
			cancelledAt: set.cancelled === undefined ? undefined : set.cancelled ? new Date() : null
		})
		.where(and(eq(job.organizationId, ctx.orgId), eq(job.id, id)))
		.returning();
	if (set.blocked !== undefined && set.blocked !== existing.blocked)
		await emit({
			orgId: ctx.orgId,
			actorId: ctx.userId,
			entityType: 'job',
			entityId: id,
			action: set.blocked ? 'blocked' : 'unblocked',
			summary: `J-${existing.number} ${set.blocked ? 'flagged waiting on parts' : 'unblocked'}`
		});
	if (set.cancelled === true) {
		await stopOpenTimers(ctx.orgId, id);
		await emit({
			orgId: ctx.orgId,
			actorId: ctx.userId,
			entityType: 'job',
			entityId: id,
			action: 'cancelled',
			summary: `Job J-${existing.number} cancelled`
		});
	}
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

/** Store the customer's sign-off on a job — PNG data URL + printed name. */
export async function signJob(ctx: OrgContext, input: v.InferOutput<typeof s.jobSignatureInput>) {
	const [j] = await db
		.select()
		.from(job)
		.where(and(eq(job.organizationId, ctx.orgId), eq(job.id, input.jobId)));
	if (!j) error(404, 'Job not found');
	if (j.status === 'cancelled') error(409, 'Job is cancelled');
	const [row] = await db
		.update(job)
		.set({ signature: input.signature, signedName: input.name, signedAt: new Date() })
		.where(eq(job.id, input.jobId))
		.returning();
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'job',
		entityId: input.jobId,
		action: 'signature',
		summary: `J-${j.number} signed by ${input.name}`
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
	const fromIso = from.toISOString().slice(0, 10);
	const toIso = to.toISOString().slice(0, 10);
	const [scheduled, unscheduled, technicians, timeOff] = await Promise.all([
		listJobs(orgId, { from, to }),
		listJobs(orgId, { unscheduled: true }),
		listTechnicians(orgId),
		db
			.select()
			.from(memberTimeOff)
			.where(
				and(
					eq(memberTimeOff.organizationId, orgId),
					lte(memberTimeOff.startsOn, toIso),
					gte(memberTimeOff.endsOn, fromIso)
				)
			)
	]);
	return { scheduled, unscheduled, technicians, timeOff };
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

/** The calling technician's My Day payload: window jobs, their unscheduled queue, open timer. */
export async function myDay(ctx: OrgContext, from: Date, to: Date) {
	const me = await memberFor(ctx);
	if (!me) return { member: null, jobs: [], unscheduled: [], openEntry: null };
	const [jobs, unscheduled, openEntries] = await Promise.all([
		listJobs(ctx.orgId, { from, to, technicianId: me.id }),
		listJobs(ctx.orgId, { technicianId: me.id, status: ['unscheduled'] }),
		db
			.select({ entry: jobTimeEntry, jobNumber: job.number })
			.from(jobTimeEntry)
			.innerJoin(job, eq(jobTimeEntry.jobId, job.id))
			.where(
				and(
					eq(jobTimeEntry.organizationId, ctx.orgId),
					eq(jobTimeEntry.memberId, me.id),
					isNull(jobTimeEntry.endedAt)
				)
			)
			.limit(1)
	]);
	return { member: me, jobs, unscheduled, openEntry: openEntries[0] ?? null };
}

export { addDays };

// ---------- Time off ----------

/** 409 when the tech has a time-off block overlapping the job's day(s). */
export async function assertTechAvailable(
	orgId: string,
	memberId: string | null,
	start: Date,
	tz: string,
	end?: Date | null,
	excludeJobId?: string
) {
	if (!memberId) return;
	const day = localDate(start, tz);
	const [block] = await db
		.select({ startsOn: memberTimeOff.startsOn, endsOn: memberTimeOff.endsOn, name: user.name })
		.from(memberTimeOff)
		.innerJoin(member, eq(memberTimeOff.memberId, member.id))
		.innerJoin(user, eq(member.userId, user.id))
		.where(
			and(
				eq(memberTimeOff.organizationId, orgId),
				eq(memberTimeOff.memberId, memberId),
				lte(memberTimeOff.startsOn, day),
				gte(memberTimeOff.endsOn, day)
			)
		)
		.limit(1);
	if (block)
		error(
			409,
			`${block.name} is off ${block.startsOn === block.endsOn ? `on ${block.startsOn}` : `${block.startsOn} to ${block.endsOn}`}`
		);

	// Double-booking guard: another live job overlapping [start, end).
	if (end && end > start) {
		const [conflict] = await db
			.select({ number: job.number, name: user.name })
			.from(job)
			.innerJoin(member, eq(job.technicianId, member.id))
			.innerJoin(user, eq(member.userId, user.id))
			.where(
				and(
					eq(job.organizationId, orgId),
					eq(job.technicianId, memberId),
					lt(job.startsAt, end),
					sql`${job.endsAt} > ${start.toISOString()}`,
					inArray(job.status, ['scheduled', 'dispatched', 'in_progress']),
					excludeJobId ? sql`${job.id} != ${excludeJobId}` : undefined
				)
			)
			.limit(1);
		if (conflict) error(409, `${conflict.name} is already on J-${conflict.number} at that time`);
	}
}

export async function listTimeOff(orgId: string) {
	return db
		.select({ timeOff: memberTimeOff, memberName: user.name })
		.from(memberTimeOff)
		.innerJoin(member, eq(memberTimeOff.memberId, member.id))
		.innerJoin(user, eq(member.userId, user.id))
		.where(eq(memberTimeOff.organizationId, orgId))
		.orderBy(asc(memberTimeOff.startsOn));
}

export async function addTimeOff(ctx: OrgContext, input: v.InferOutput<typeof s.timeOffInput>) {
	if (input.endsOn < input.startsOn) error(400, 'End date is before the start date');
	const [m] = await db
		.select({ id: member.id })
		.from(member)
		.where(and(eq(member.id, input.memberId), eq(member.organizationId, ctx.orgId)))
		.limit(1);
	if (!m) error(404, 'Staff member not found');
	const [row] = await db
		.insert(memberTimeOff)
		.values({
			organizationId: ctx.orgId,
			memberId: input.memberId,
			startsOn: input.startsOn,
			endsOn: input.endsOn,
			reason: input.reason
		})
		.returning();
	return row;
}

export async function deleteTimeOff(ctx: OrgContext, id: string) {
	const [row] = await db
		.delete(memberTimeOff)
		.where(and(eq(memberTimeOff.id, id), eq(memberTimeOff.organizationId, ctx.orgId)))
		.returning();
	if (!row) error(404, 'Time-off entry not found');
}

/** Job id for a checklist item — used to refresh the right queries before delete. */
export async function getChecklistJobId(orgId: string, id: string) {
	const [row] = await db
		.select({ jobId: jobChecklistItem.jobId })
		.from(jobChecklistItem)
		.where(and(eq(jobChecklistItem.id, id), eq(jobChecklistItem.organizationId, orgId)))
		.limit(1);
	return row?.jobId;
}

// ---------- Job expenses ----------

/** Non-material costs logged on a job, newest first. */
export async function listJobExpenses(orgId: string, jobId: string) {
	return db
		.select({ expense: jobExpense, memberName: user.name })
		.from(jobExpense)
		.leftJoin(member, eq(jobExpense.memberId, member.id))
		.leftJoin(user, eq(member.userId, user.id))
		.where(and(eq(jobExpense.organizationId, orgId), eq(jobExpense.jobId, jobId)))
		.orderBy(sql`${jobExpense.createdAt} desc`);
}

/** Log a non-material cost (permit, subcontractor, misc) on a job. */
export async function addJobExpense(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.jobExpenseInput>
) {
	const [j] = await db
		.select({ id: job.id })
		.from(job)
		.where(and(eq(job.id, input.jobId), eq(job.organizationId, ctx.orgId)))
		.limit(1);
	if (!j) error(404, 'Job not found');
	const me = ctx.userId
		? (
				await db
					.select({ id: member.id })
					.from(member)
					.where(and(eq(member.userId, ctx.userId), eq(member.organizationId, ctx.orgId)))
					.limit(1)
			)[0]
		: null;
	const [e] = await db
		.insert(jobExpense)
		.values({
			organizationId: ctx.orgId,
			jobId: input.jobId,
			description: input.description,
			vendor: input.vendor,
			amount: input.amount,
			incurredOn: input.incurredOn || null,
			memberId: me?.id ?? null
		})
		.returning();
	void emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'job',
		entityId: input.jobId,
		action: 'expense_added',
		summary: `Expense: ${input.description}`
	});
	return e;
}

export async function removeJobExpense(ctx: OrgContext, expenseId: string) {
	const [e] = await db
		.delete(jobExpense)
		.where(and(eq(jobExpense.id, expenseId), eq(jobExpense.organizationId, ctx.orgId)))
		.returning();
	if (!e) error(404, 'Expense not found');
	void emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'job',
		entityId: e.jobId,
		action: 'expense_removed',
		summary: `Removed expense: ${e.description}`
	});
	return e;
}

/** Signed iCal feed URL for the calling technician (`/api/cal/<member>.<hmac>`), or null for non-techs. */
export async function calendarFeed(ctx: OrgContext) {
	const me = await memberFor(ctx);
	if (!me) return null;
	return `/api/cal/${me.id}.${createHmac('sha256', BETTER_AUTH_SECRET)
		.update(`cal:${me.id}`)
		.digest('base64url')}`;
}

/** Clone a job `count` times, each `everyWeeks` weeks apart — unscheduled sources clone into the queue. */
export async function repeatJob(
	ctx: OrgContext,
	tz: string,
	input: v.InferOutput<typeof s.jobRepeatInput>
) {
	const src = await getJob(ctx.orgId, input.jobId);
	if (!src.job.customerId) error(400, 'Job has no customer');
	const made: (typeof job.$inferSelect)[] = [];
	for (let i = 1; i <= input.count; i++) {
		const startsAt = src.job.startsAt
			? (() => {
					const d = new Date(src.job.startsAt!.getTime() + i * input.everyWeeks * 7 * 86400_000);
					return `${localDate(d, tz)}T${localTime(d, tz)}`;
				})()
			: null;
		made.push(
			await createJob(
				ctx,
				tz,
				{
					customerId: src.job.customerId,
					jobTypeId: src.job.jobTypeId ?? null,
					serviceLocationId: src.job.serviceLocationId ?? null,
					equipmentId: src.job.equipmentId ?? null,
					officeId: src.job.officeId ?? null,
					technicianId: src.job.technicianId ?? null,
					summary: src.job.summary,
					description: src.job.description,
					priority: src.job.priority,
					preferredTime: null,
					startsAt
				},
				{ source: src.job.source ?? 'manual' }
			)
		);
	}
	return made;
}
