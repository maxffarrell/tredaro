import { createHmac, timingSafeEqual } from 'node:crypto';
import { BETTER_AUTH_SECRET } from '$app/env/private';
import { error } from '@sveltejs/kit';
import {
	and,
	asc,
	count,
	desc,
	eq,
	getTableColumns,
	gt,
	gte,
	inArray,
	isNotNull,
	isNull,
	like,
	lt,
	lte,
	ne,
	or,
	sql
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '#lib/server/db/index.ts';
import { appOrigin } from '#lib/server/email.ts';
import { createInvoice } from './billing.ts';
import { listJobMaterials } from './inventory.ts';
import { listFollowUps } from './followups.ts';
import {
	bookingWaitlist,
	charge,
	customer,
	equipment,
	inventoryItem,
	truckStock,
	invoice,
	job,
	jobExpense,
	jobMaterial,
	jobChecklistItem,
	jobDocument,
	jobEvent,
	jobPhoto,
	jobTimeEntry,
	jobType,
	member,
	memberDayNote,
	memberTimeOff,
	office,
	payment,
	serviceLocation,
	user,
	outer
} from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import { emit } from './events.ts';
import { getSettings, nextNumber } from './settings.ts';
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
			hourlyRate: input.hourlyRate ?? null,
			officeId: input.officeId ?? null,
			technicianId: input.technicianId ?? null,
			checklist: input.checklist,
			requireChecklist: input.requireChecklist,
			requirePhoto: input.requirePhoto,
			requireSignature: input.requireSignature,
			requireDocument: input.requireDocument,
			requireTimer: input.requireTimer,
			requiresHelper: input.requiresHelper,
			laborWarrantyDays: input.laborWarrantyDays,
			bookable: input.bookable,
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
	typeDurationMin: jobType.durationMin,
	typeRequiresHelper: jobType.requiresHelper,
	color: jobType.color,
	customerName: customer.name,
	companyName: customer.companyName,
	customerPhone: customer.phone,
	customerEmail: customer.email,
	technicianName: user.name,
	equipmentName: equipment.name,
	locationLabel: serviceLocation.label,
	address1: serviceLocation.address1,
	city: serviceLocation.city,
	state: serviceLocation.state,
	zip: serviceLocation.zip,
	accessNotes: serviceLocation.accessNotes,
	checklistTotal:
		sql<number>`(select count(*) from ${jobChecklistItem} ci where ci.job_id = ${outer(job.id)})`.mapWith(
			Number
		),
	checklistDone:
		sql<number>`(select count(*) from ${jobChecklistItem} ci where ci.job_id = ${outer(job.id)} and ci.done)`.mapWith(
			Number
		),
	/** True once the customer confirms the visit from the portal ('confirmed' event). */
	confirmed:
		sql<boolean>`exists (select 1 from ${jobEvent} e where e.job_id = ${outer(job.id)} and e.kind = 'confirmed')`.mapWith(
			Boolean
		),
	/** True when any charge on the job is linked to an invoice. */
	invoiced:
		sql<boolean>`exists (select 1 from ${charge} c where c.job_id = ${outer(job.id)} and c.invoice_id is not null)`.mapWith(
			Boolean
		),
	/** Number of the predecessor job, when one is set. */
	depNumber: sql<
		number | null
	>`(select dep.number from job dep where dep.id = ${outer(job.dependsOnJobId)})`.mapWith(Number),
	/** True while the predecessor job exists and isn't done or cancelled. */
	depOpen:
		sql<boolean>`(select dep.status not in ('done','cancelled') from job dep where dep.id = ${outer(job.dependsOnJobId)})`.mapWith(
			Boolean
		),
	/** Customer asked to cancel and staff haven't approved/declined yet. */
	cancelRequested:
		sql<boolean>`(select exists (select 1 from job_event req where req.job_id = ${outer(job.id)} and req.kind = 'note' and req.note like 'Customer requested cancellation%' and not exists (select 1 from job_event res where res.job_id = req.job_id and res.kind = 'note' and res.note like 'Cancellation request %')))`.mapWith(
			Boolean
		)
};

export async function listJobs(
	orgId: string,
	opts: {
		from?: Date;
		to?: Date;
		status?: string[];
		technicianId?: string;
		/** Match jobs where the member is tech OR helper (My Day). */
		orHelper?: boolean;
		/** Only jobs with no technician assigned. */
		unassigned?: boolean;
		unscheduled?: boolean;
		officeId?: string;
		equipmentId?: string;
		blocked?: boolean;
		customerId?: string;
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
				opts.officeId ? eq(job.officeId, opts.officeId) : undefined,
				opts.status?.length
					? sql`${outer(job.status)} in (${sql.join(
							opts.status.map((x) => sql`${x}`),
							sql`, `
						)})`
					: undefined,
				opts.technicianId
					? opts.orHelper
						? or(eq(job.technicianId, opts.technicianId), eq(job.helperId, opts.technicianId))
						: eq(job.technicianId, opts.technicianId)
					: undefined,
				opts.unassigned ? isNull(job.technicianId) : undefined,
				opts.equipmentId ? eq(job.equipmentId, opts.equipmentId) : undefined,
				opts.blocked ? eq(job.blocked, true) : undefined,
				opts.customerId ? eq(job.customerId, opts.customerId) : undefined
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

/** Per-status job counts for the /jobs tab badges (respects the tech filter). */
export async function jobCounts(orgId: string, technicianId?: string) {
	const rows = await db
		.select({
			status: job.status,
			n: sql<number>`count(*)`.mapWith(Number)
		})
		.from(job)
		.where(
			and(
				eq(job.organizationId, orgId),
				technicianId ? eq(job.technicianId, technicianId) : undefined
			)
		)
		.groupBy(job.status);
	const counts = Object.fromEntries(rows.map((r) => [r.status, r.n]));
	const [b] = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(job)
		.where(
			and(
				eq(job.organizationId, orgId),
				eq(job.blocked, true),
				ne(job.status, 'done'),
				ne(job.status, 'cancelled'),
				technicianId ? eq(job.technicianId, technicianId) : undefined
			)
		);
	counts.blocked = b?.n ?? 0;
	const monthStart = new Date(
		`${localDate(new Date(), (await getSettings(orgId)).timezone).slice(0, 7)}-01T00:00:00Z`
	);
	const [dm] = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(job)
		.where(
			and(
				eq(job.organizationId, orgId),
				eq(job.status, 'done'),
				gte(job.completedAt, monthStart),
				technicianId ? eq(job.technicianId, technicianId) : undefined
			)
		);
	counts.doneThisMonth = dm?.n ?? 0;
	return counts;
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

	const tz = (await getSettings(orgId)).timezone;
	const sameDay = row.job.startsAt
		? (
				await db
					.select({ n: count() })
					.from(job)
					.where(
						and(
							eq(job.organizationId, orgId),
							eq(job.customerId, row.job.customerId),
							ne(job.id, id),
							sql`${job.status} not in ('done', 'cancelled')`,
							gte(job.startsAt, zonedToUtc(localDate(row.job.startsAt, tz) + 'T00:00', tz)),
							lt(
								job.startsAt,
								zonedToUtc(addDays(localDate(row.job.startsAt, tz), 1) + 'T00:00', tz)
							)
						)
					)
			)[0].n
		: 0;
	const techDay =
		row.job.startsAt && row.job.technicianId
			? (
					await db
						.select({ n: count() })
						.from(job)
						.where(
							and(
								eq(job.organizationId, orgId),
								eq(job.technicianId, row.job.technicianId),
								ne(job.id, id),
								sql`${job.status} not in ('done', 'cancelled')`,
								gte(job.startsAt, zonedToUtc(localDate(row.job.startsAt, tz) + 'T00:00', tz)),
								lt(
									job.startsAt,
									zonedToUtc(addDays(localDate(row.job.startsAt, tz), 1) + 'T00:00', tz)
								)
							)
						)
				)[0].n
			: 0;

	const depOptions = await db
		.select({ id: job.id, number: job.number, summary: job.summary, status: job.status })
		.from(job)
		.where(
			and(
				eq(job.organizationId, orgId),
				eq(job.customerId, row.job.customerId),
				ne(job.id, id),
				sql`${job.status} not in ('done', 'cancelled')`
			)
		)
		.orderBy(asc(job.number));

	// Open jobs waiting on this one ("blocks" list).
	const depJobs = await db
		.select({ id: job.id, number: job.number, summary: job.summary, status: job.status })
		.from(job)
		.where(
			and(
				eq(job.organizationId, orgId),
				eq(job.dependsOnJobId, id),
				sql`${job.status} not in ('done', 'cancelled')`
			)
		)
		.orderBy(asc(job.number));

	const locJobs = row.job.serviceLocationId
		? await db
				.select({
					id: job.id,
					number: job.number,
					summary: job.summary,
					status: job.status
				})
				.from(job)
				.where(
					and(
						eq(job.organizationId, orgId),
						eq(job.serviceLocationId, row.job.serviceLocationId),
						ne(job.id, id),
						sql`${job.status} not in ('done', 'cancelled')`
					)
				)
				.orderBy(asc(job.number))
		: [];

	return {
		...row,
		events,
		openBalance: open,
		costing,
		sameDay,
		techDay,
		depOptions,
		depJobs,
		locJobs,
		followUps: await listFollowUps(orgId, { jobId: id })
	};
}

/** J-number of the unfinished predecessor blocking a job, or null when unblocked. */
async function depBlock(orgId: string, dependsOnJobId: string | null | undefined) {
	if (!dependsOnJobId) return null;
	const [dep] = await db
		.select({ number: job.number, status: job.status })
		.from(job)
		.where(and(eq(job.organizationId, orgId), eq(job.id, dependsOnJobId)));
	return dep && dep.status !== 'done' && dep.status !== 'cancelled' ? dep.number : null;
}

/** Validate a depends_on choice: exists in org, isn't self, and doesn't loop back. */
async function assertValidDependency(orgId: string, jobId: string | null, depId: string) {
	const [dep] = await db
		.select({ id: job.id, dependsOnJobId: job.dependsOnJobId })
		.from(job)
		.where(and(eq(job.organizationId, orgId), eq(job.id, depId)));
	if (!dep) error(404, 'Depends-on job not found');
	if (jobId === null) return;
	let cur: string | null = depId;
	for (let i = 0; i < 30 && cur; i++) {
		if (cur === jobId) error(409, 'That would create a dependency loop');
		const [d] = await db
			.select({ dependsOnJobId: job.dependsOnJobId })
			.from(job)
			.where(and(eq(job.organizationId, orgId), eq(job.id, cur)));
		cur = d?.dependsOnJobId ?? null;
	}
}

/** Creates a job. `startsAt` is a wall-clock time in the workspace timezone; omit for unscheduled. */
export async function createJob(
	ctx: { orgId: string; userId?: string | null },
	tz: string,
	input: v.InferOutput<typeof s.jobInput>,
	opts: {
		source?: (typeof job.$inferInsert)['source'];
		number?: number;
		/** Explicit duration (min) — defaults to the job type's. Used by copy-week. */
		durationMin?: number;
	} = {}
) {
	const [c] = await db
		.select()
		.from(customer)
		.where(and(eq(customer.organizationId, ctx.orgId), eq(customer.id, input.customerId)));
	if (!c) error(404, 'Customer not found');
	if (c.onHold) error(409, 'Customer is on credit hold — resolve the balance first');
	if (c.doNotService) error(409, 'Customer is flagged do-not-service');

	const jt = input.jobTypeId
		? (
				await db
					.select()
					.from(jobType)
					.where(and(eq(jobType.organizationId, ctx.orgId), eq(jobType.id, input.jobTypeId)))
			)[0]
		: null;
	if (input.jobTypeId && !jt) error(404, 'Job type not found');
	if (input.dependsOnJobId) await assertValidDependency(ctx.orgId, null, input.dependsOnJobId);

	const number = opts.number ?? (await nextNumber(ctx.orgId, 'job'));
	const start = input.startsAt ? zonedToUtc(input.startsAt, tz) : null;
	if (start && jt?.requiresHelper && !input.helperId)
		error(409, 'This job type needs a second tech — pick a helper before scheduling');
	const durationMin = opts.durationMin ?? jt?.durationMin ?? 60;
	// A completed job at this location still inside its labor-warranty window makes
	// the follow-up warranty work (no charge) unless the caller explicitly sets it.
	let coveredBy: { number: number; warrantyUntil: Date | null } | null = null;
	if (input.serviceLocationId && input.warranty == null) {
		[coveredBy] = await db
			.select({ number: job.number, warrantyUntil: job.warrantyUntil })
			.from(job)
			.where(
				and(
					eq(job.organizationId, ctx.orgId),
					eq(job.serviceLocationId, input.serviceLocationId),
					gt(job.warrantyUntil, new Date())
				)
			)
			.orderBy(desc(job.warrantyUntil))
			.limit(1);
		coveredBy ??= null;
	}
	// Tech resolution: explicit pick > job type default > the customer's preferred tech.
	const technicianId = input.technicianId ?? jt?.technicianId ?? c.preferredMemberId ?? null;
	if (start)
		await assertTechAvailable(
			ctx.orgId,
			technicianId,
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
			technicianId,
			helperId: input.helperId ?? null,
			equipmentId: input.equipmentId ?? null,
			summary: input.summary || jt?.name || '',
			description: input.description,
			priority: input.priority,
			tags: input.tags,
			preferredTime: input.preferredTime ?? null,
			warranty: input.warranty ?? coveredBy != null,
			arrivalWindow: input.arrivalWindow ?? null,
			source: opts.source ?? 'manual',
			dependsOnJobId: input.dependsOnJobId ?? null,
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
	if (coveredBy)
		await db.insert(jobEvent).values({
			organizationId: ctx.orgId,
			jobId: row!.id,
			kind: 'note',
			note: `Auto-flagged warranty — this location is covered by J-${coveredBy.number} through ${coveredBy.warrantyUntil ? coveredBy.warrantyUntil.toISOString().slice(0, 10) : '—'}`
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

/** Duplicates the viewed week's scheduled/dispatched jobs onto the same weekday next week. */
export async function copyScheduleWeek(ctx: OrgContext, weekStartIso: string) {
	const tz = (await getSettings(ctx.orgId)).timezone;
	const from = zonedToUtc(`${weekStartIso}T00:00`, tz);
	const to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
	const rows = await db
		.select()
		.from(job)
		.where(
			and(
				eq(job.organizationId, ctx.orgId),
				inArray(job.status, ['scheduled', 'dispatched']),
				gte(job.startsAt, from),
				lt(job.startsAt, to)
			)
		)
		.orderBy(asc(job.startsAt));
	let created = 0;
	let skipped = 0;
	for (const src of rows) {
		const newStart = new Date(src.startsAt!.getTime() + 7 * 24 * 60 * 60 * 1000);
		const wall = `${localDate(newStart, tz)}T${localTime(newStart, tz)}`;
		const dur =
			src.startsAt && src.endsAt
				? Math.round((src.endsAt.getTime() - src.startsAt.getTime()) / 60_000)
				: undefined;
		try {
			await createJob(
				ctx,
				tz,
				{
					customerId: src.customerId,
					serviceLocationId: src.serviceLocationId ?? null,
					jobTypeId: src.jobTypeId ?? null,
					officeId: src.officeId ?? null,
					technicianId: src.technicianId ?? null,
					equipmentId: src.equipmentId ?? null,
					summary: src.summary,
					description: src.description,
					priority: src.priority,
					preferredTime: src.preferredTime ?? null,
					arrivalWindow: src.arrivalWindow ?? null,
					warranty: src.warranty,
					startsAt: wall
				},
				{ source: 'manual', durationMin: dur }
			);
			created++;
		} catch {
			// Off-day or scheduling conflict — that job is skipped, the rest still copy.
			skipped++;
		}
	}
	return { created, skipped };
}

/** Copy a job — same customer/site/equipment/type/summary/priority/checklist, fresh unscheduled number. */
export async function duplicateJob(ctx: OrgContext, jobId: string) {
	const [src] = await db
		.select()
		.from(job)
		.where(and(eq(job.organizationId, ctx.orgId), eq(job.id, jobId)));
	if (!src) error(404, 'Job not found');
	const number = await nextNumber(ctx.orgId, 'job');
	const [row] = await db
		.insert(job)
		.values({
			organizationId: ctx.orgId,
			number,
			jobTypeId: src.jobTypeId,
			customerId: src.customerId,
			serviceLocationId: src.serviceLocationId,
			equipmentId: src.equipmentId,
			officeId: src.officeId,
			technicianId: src.technicianId,
			summary: src.summary,
			description: src.description,
			priority: src.priority,
			preferredTime: src.preferredTime,
			warranty: src.warranty,
			arrivalWindow: src.arrivalWindow,
			source: 'manual',
			status: 'unscheduled'
		})
		.returning();
	const items = await db
		.select()
		.from(jobChecklistItem)
		.where(eq(jobChecklistItem.jobId, jobId))
		.orderBy(asc(jobChecklistItem.sort));
	if (items.length)
		await db.insert(jobChecklistItem).values(
			items.map((i) => ({
				organizationId: ctx.orgId,
				jobId: row!.id,
				label: i.label,
				sort: i.sort
			}))
		);
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'job',
		entityId: row!.id,
		action: 'created',
		summary: `Job J-${number}: ${row!.summary} (copied from J-${src.number})`
	});
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
	if (set.dependsOnJobId) await assertValidDependency(ctx.orgId, id, set.dependsOnJobId);

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
	const explicitEnd =
		set.endsAt === undefined ? undefined : set.endsAt === null ? null : zonedToUtc(set.endsAt, tz);
	const endsAt =
		explicitEnd !== undefined
			? explicitEnd
			: start === undefined
				? set.durationMin !== undefined && existing.startsAt
					? new Date(existing.startsAt.getTime() + durationMin * 60_000)
					: undefined
				: start === null
					? null
					: new Date(start.getTime() + durationMin * 60_000);

	const effectiveStart = start === undefined ? existing.startsAt : start;
	const effectiveEnd = endsAt === undefined ? existing.endsAt : endsAt;
	if (effectiveStart && effectiveEnd && effectiveEnd <= effectiveStart)
		error(400, 'End must be after the start');
	const effectiveTech = set.technicianId === undefined ? existing.technicianId : set.technicianId;
	// An unreviewed online booking can't be scheduled or assigned — that would
	// skip the accept/decline step. Other edits (notes, priority) stay open.
	if (
		existing.needsReview &&
		set.cancelled !== true &&
		((set.startsAt !== undefined && start) ||
			(set.technicianId && set.technicianId !== existing.technicianId))
	)
		error(409, 'Review this online booking first — accept or decline it');
	// Cancellations never gate on availability — a PTO block can't prevent
	// marking a visit cancelled.
	if (effectiveStart && set.cancelled !== true)
		await assertTechAvailable(
			ctx.orgId,
			effectiveTech,
			effectiveStart,
			tz,
			effectiveEnd ?? new Date(effectiveStart.getTime() + durationMin * 60_000),
			id
		);
	// The helper gets the same time-off guard when they're newly added or the slot moves.
	const effectiveHelper = set.helperId === undefined ? existing.helperId : set.helperId;
	// Two-person job types can't be scheduled without a helper on the job.
	if (effectiveStart) {
		const typeId = set.jobTypeId === undefined ? existing.jobTypeId : set.jobTypeId;
		if (typeId && !effectiveHelper) {
			const [type] = await db
				.select({ requiresHelper: jobType.requiresHelper })
				.from(jobType)
				.where(and(eq(jobType.id, typeId), eq(jobType.organizationId, ctx.orgId)))
				.limit(1);
			if (type?.requiresHelper)
				error(409, 'This job type needs a second tech — pick a helper before scheduling');
		}
	}
	if (
		effectiveHelper &&
		effectiveStart &&
		(effectiveHelper !== existing.helperId || start !== undefined)
	)
		await assertTechAvailable(
			ctx.orgId,
			effectiveHelper,
			effectiveStart,
			tz,
			effectiveEnd ?? new Date(effectiveStart.getTime() + durationMin * 60_000),
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
			helperId: set.helperId,
			summary: set.summary,
			description: set.description,
			priority: set.priority,
			tags: set.tags,
			blocked: set.blocked,
			warranty: set.warranty,
			dependsOnJobId: set.dependsOnJobId,
			arrivalWindow: set.arrivalWindow,
			completionNotes: set.completionNotes,
			startsAt: start,
			endsAt,
			status,
			cancelledAt: set.cancelled === undefined ? undefined : set.cancelled ? new Date() : null,
			cancelReason:
				set.cancelled === true
					? (set.cancelReason ?? null)
					: set.cancelled === false
						? null
						: undefined
		})
		.where(and(eq(job.organizationId, ctx.orgId), eq(job.id, id)))
		.returning();
	// Rescheduled (not reassigned): when the same tech's start time moves, email
	// them the new slot. Assignment emails cover first assignment; the notify fn
	// skips jobs that were never tech-assigned.
	if (
		start !== undefined &&
		row?.technicianId &&
		existing.technicianId === row.technicianId &&
		existing.startsAt?.getTime() !== row.startsAt?.getTime()
	) {
		const { notifyTechRescheduled } = await import('./notifications.ts');
		notifyTechRescheduled(ctx.orgId, id, row.technicianId).catch((err) =>
			console.error('tech reschedule email failed', err)
		);
	}
	// Customer-facing reschedule notice — armed whenever an already-scheduled
	// slot actually moves (first-time scheduling is covered by job_scheduled).
	if (
		start !== undefined &&
		existing.startsAt &&
		row?.startsAt &&
		existing.startsAt.getTime() !== row.startsAt.getTime()
	) {
		const { notifyJobRescheduledCustomer } = await import('./notifications.ts');
		notifyJobRescheduledCustomer(ctx.orgId, id).catch((err) =>
			console.error('customer reschedule notify failed', err)
		);
	}
	if (set.blocked !== undefined && set.blocked !== existing.blocked)
		await emit({
			orgId: ctx.orgId,
			actorId: ctx.userId,
			entityType: 'job',
			entityId: id,
			action: set.blocked ? 'blocked' : 'unblocked',
			summary: `J-${existing.number} ${set.blocked ? 'flagged waiting on parts' : 'unblocked'}`
		});
	if (set.blocked === false && existing.blocked && row.technicianId) {
		const { notifyPartsArrived } = await import('./notifications.ts');
		notifyPartsArrived(ctx.orgId, id, row.technicianId).catch((err) =>
			console.error('parts arrived notify failed', err)
		);
	}
	if (set.cancelled === true) {
		await stopOpenTimers(ctx.orgId, id);
		const [memberRow] = await db
			.select({ id: member.id })
			.from(member)
			.where(and(eq(member.organizationId, ctx.orgId), eq(member.userId, ctx.userId)));
		await db.insert(jobEvent).values({
			organizationId: ctx.orgId,
			jobId: id,
			kind: 'note',
			memberId: memberRow?.id ?? null,
			note: `Job cancelled${set.cancelReason ? ` — ${set.cancelReason}` : ''}`
		});
		await emit({
			orgId: ctx.orgId,
			actorId: ctx.userId,
			entityType: 'job',
			entityId: id,
			action: 'cancelled',
			summary: `Job J-${existing.number} cancelled${set.cancelReason ? ` — ${set.cancelReason}` : ''}`
		});
		// Only notify when a slot was actually booked — an unscheduled cancel
		// never promised the customer a time.
		if (existing.startsAt) {
			const { notifyJobCancelled } = await import('./notifications.ts');
			notifyJobCancelled(ctx.orgId, id).catch((err) =>
				console.error('customer cancel notify failed', err)
			);
		}
	}
	return row;
}

/** Staff verdict on an online booking made while review mode is on. Approve clears
 * the flag so the job queues normally; decline cancels it with a recorded reason. */
export async function reviewBooking(ctx: OrgContext, jobId: string, approve: boolean) {
	const [j] = await db
		.select()
		.from(job)
		.where(and(eq(job.organizationId, ctx.orgId), eq(job.id, jobId)));
	if (!j) error(404, 'Job not found');
	if (!j.needsReview) error(409, 'Booking already reviewed');
	if (!approve) {
		const tz = (await getSettings(ctx.orgId)).timezone;
		await updateJob(ctx, tz, {
			id: jobId,
			cancelled: true,
			cancelReason: 'Online booking declined'
		});
		return { approved: false };
	}
	await db.update(job).set({ needsReview: false }).where(eq(job.id, jobId));
	await db.insert(jobEvent).values({
		organizationId: ctx.orgId,
		jobId,
		kind: 'note',
		note: 'Online booking approved'
	});
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'job',
		entityId: jobId,
		action: 'booking-approved',
		summary: `Online booking J-${j.number} approved`
	});
	return { approved: true };
}

/** Tech taps "Running late" — texts the customer a new ETA and notes it on the timeline. */
export async function runningLate(ctx: OrgContext, jobId: string, minutes: number) {
	const [j] = await db
		.select()
		.from(job)
		.where(and(eq(job.organizationId, ctx.orgId), eq(job.id, jobId)));
	if (!j) error(404, 'Job not found');
	if (j.status === 'done' || j.status === 'cancelled') error(409, `Job is ${j.status}`);
	const me = await memberFor(ctx);
	const [c] = await db.select().from(customer).where(eq(customer.id, j.customerId));
	if (!c?.phone) error(409, 'Customer has no phone on file');
	const tz = (await getSettings(ctx.orgId)).timezone;
	const eta = new Date(Date.now() + minutes * 60_000);
	const when = localTime(eta, tz);
	const { sendSmsQuiet, logOnce } = await import('./notifications.ts');
	const sent = await logOnce(ctx.orgId, 'job_running_late', `${jobId}:${minutes}`, c.phone);
	if (!sent) return { sent: false, when };
	await sendSmsQuiet(ctx.orgId, {
		to: c.phone,
		body: `Hi ${c.name.split(' ')[0]}, ${me?.name ?? 'your technician'} is running about ${minutes} min behind — new ETA about ${when}. Sorry for the delay!`
	});
	await db.insert(jobEvent).values({
		organizationId: ctx.orgId,
		jobId,
		kind: 'note',
		memberId: me?.id ?? null,
		note: `Customer texted: running ~${minutes} min late (ETA ~${when})`
	});
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'job',
		entityId: jobId,
		action: 'running-late',
		summary: `Running ~${minutes} min late on J-${j.number} — customer texted`
	});
	return { sent: true, when };
}

/** Tech arrived to a no-show: cancels the visit and rebooks it as an unscheduled copy. */
export async function markNoShow(ctx: OrgContext, jobId: string) {
	const [src] = await db
		.select()
		.from(job)
		.where(and(eq(job.organizationId, ctx.orgId), eq(job.id, jobId)));
	if (!src) error(404, 'Job not found');
	if (src.status === 'done' || src.status === 'cancelled') error(409, `Job is ${src.status}`);
	const tz = (await getSettings(ctx.orgId)).timezone;
	await updateJob(ctx, tz, { id: jobId, cancelled: true, cancelReason: 'Customer no-show' });
	const copy = await duplicateJob(ctx, jobId);
	await db.insert(jobEvent).values({
		organizationId: ctx.orgId,
		jobId: copy.id,
		kind: 'note',
		note: `Rebooked after a no-show on J-${src.number}`
	});
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'job',
		entityId: copy.id,
		action: 'rebooked',
		summary: `J-${src.number} no-show → rebooked as J-${copy.number}`
	});
	return copy;
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

	// Dependencies: a job waiting on a predecessor can't be dispatched or completed.
	if (input.kind !== 'note') {
		const blocking = await depBlock(ctx.orgId, j.dependsOnJobId);
		if (blocking) error(409, `Blocked by J-${blocking} — finish it first`);
	}

	// On-site gate: job types can require the tech to clock in before marking
	// on-site — payroll-grade jobs can't skip the timer.
	if (input.kind === 'on_site' && j.jobTypeId) {
		const [type] = await db
			.select({ requireTimer: jobType.requireTimer })
			.from(jobType)
			.where(eq(jobType.id, j.jobTypeId));
		if (type?.requireTimer) {
			const caller = await memberFor(ctx);
			const who = j.technicianId ?? caller?.id ?? '';
			const [{ n }] = await db
				.select({ n: sql<number>`count(*)`.mapWith(Number) })
				.from(jobTimeEntry)
				.where(and(eq(jobTimeEntry.jobId, input.jobId), eq(jobTimeEntry.memberId, who)));
			if (n === 0)
				error(409, 'Clock in first — this job type requires logged time before arriving on site');
		}
	}

	// Job-type completion gates — the tech must finish the checklist and/or attach
	// a photo before the job can be marked complete.
	if (input.kind === 'completed' && j.jobTypeId) {
		const [type] = await db
			.select({
				requireChecklist: jobType.requireChecklist,
				requirePhoto: jobType.requirePhoto,
				requireSignature: jobType.requireSignature,
				requireDocument: jobType.requireDocument
			})
			.from(jobType)
			.where(eq(jobType.id, j.jobTypeId));
		if (type?.requireChecklist) {
			const [{ n: open }] = await db
				.select({ n: sql<number>`count(*)`.mapWith(Number) })
				.from(jobChecklistItem)
				.where(and(eq(jobChecklistItem.jobId, input.jobId), eq(jobChecklistItem.done, false)));
			if (open > 0) error(409, `Finish every checklist item first (${open} open)`);
		}
		if (type?.requirePhoto) {
			const [{ n }] = await db
				.select({ n: sql<number>`count(*)`.mapWith(Number) })
				.from(jobPhoto)
				.where(eq(jobPhoto.jobId, input.jobId));
			if (n === 0) error(409, 'Attach at least one photo before completing');
		}
		if (type?.requireSignature && !j.signature)
			error(409, 'Capture the customer signature before completing');
		if (type?.requireDocument) {
			const [{ n }] = await db
				.select({ n: sql<number>`count(*)`.mapWith(Number) })
				.from(jobDocument)
				.where(eq(jobDocument.jobId, input.jobId));
			if (n === 0) error(409, 'Attach at least one document before completing');
		}
	}

	const [memberRow] = await db
		.select({ id: member.id })
		.from(member)
		.where(and(eq(member.organizationId, ctx.orgId), eq(member.userId, ctx.userId)));

	// Double-clicks on the status buttons shouldn't double-log: reuse the event
	// if the same kind was recorded for this job in the last minute.
	const [recent] = await db
		.select()
		.from(jobEvent)
		.where(
			and(
				eq(jobEvent.jobId, input.jobId),
				eq(jobEvent.kind, input.kind),
				gte(jobEvent.at, new Date(Date.now() - 60_000))
			)
		)
		.limit(1);
	const [row] = recent
		? [recent]
		: await db
				.insert(jobEvent)
				.values({
					organizationId: ctx.orgId,
					jobId: input.jobId,
					kind: input.kind,
					memberId: memberRow?.id ?? null,
					note: input.note ?? null,
					lat: input.lat ?? null,
					lng: input.lng ?? null
				})
				.returning();

	const status = STATUS_FOR_EVENT[input.kind as keyof typeof STATUS_FOR_EVENT];
	if (status) {
		const doneAt = new Date();
		// Labor warranty: on completion the job type's window starts (0 = none).
		let warrantyUntil: Date | undefined;
		if (status === 'done') {
			const [j0] = await db
				.select({ days: jobType.laborWarrantyDays })
				.from(job)
				.innerJoin(jobType, eq(job.jobTypeId, jobType.id))
				.where(eq(job.id, input.jobId))
				.limit(1);
			if (j0?.days) warrantyUntil = new Date(doneAt.getTime() + j0.days * 86_400_000);
		}
		await db
			.update(job)
			.set({
				status,
				completedAt: status === 'done' ? doneAt : undefined,
				warrantyUntil,
				completionNotes: status === 'done' && input.note ? input.note : undefined
			})
			.where(eq(job.id, input.jobId));
	}
	if (input.kind === 'on_site' && memberRow?.id)
		await startTimerFor(ctx.orgId, input.jobId, memberRow.id, ctx.userId);
	if (input.kind === 'completed') {
		await stopOpenTimers(ctx.orgId, input.jobId);
		// Release dependents: inbox + email the technician on each job this unblocks.
		const dependents = await db
			.select({ id: job.id })
			.from(job)
			.where(
				and(
					eq(job.organizationId, ctx.orgId),
					eq(job.dependsOnJobId, input.jobId),
					sql`${job.status} not in ('done', 'cancelled')`
				)
			);
		if (dependents.length) {
			const { notifyJobUnblocked } = await import('./notifications.ts');
			for (const d of dependents)
				void notifyJobUnblocked(ctx.orgId, d.id, j.number).catch((err) =>
					console.error('unblocked alert failed', err)
				);
		}
		const settings = await getSettings(ctx.orgId);
		if (settings.autoInvoiceOnComplete && !j.warranty) {
			const materials = await listJobMaterials(ctx.orgId, input.jobId);
			const [existingInvoice] = await db
				.select({ id: invoice.id })
				.from(invoice)
				.where(and(eq(invoice.organizationId, ctx.orgId), eq(invoice.jobId, input.jobId)))
				.limit(1);
			if (materials.length && !existingInvoice) {
				const [cust] = await db
					.select({ termsDays: customer.termsDays })
					.from(customer)
					.where(eq(customer.id, j.customerId))
					.limit(1);
				await createInvoice(ctx, {
					customerId: j.customerId,
					jobId: j.id,
					dueDate: addDays(
						localDate(new Date(), settings.timezone),
						cust?.termsDays ?? settings.invoiceTermsDays
					),
					notes: `Auto-created when J-${j.number} was completed — review before sending`,
					items: materials.map((m) => ({
						name: m.itemName ?? m.material.customName,
						description: '',
						qty: m.material.qty,
						unitPrice: m.material.unitPrice
					}))
				});
			}
		}
	}
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
			.select({ id: member.id, name: user.name, commissionPct: member.commissionPct })
			.from(member)
			.innerJoin(user, eq(member.userId, user.id))
			.where(and(eq(member.organizationId, ctx.orgId), eq(member.userId, ctx.userId)))
	)[0];

/** A staff member marks their own time off from My Day — trusted, flagged to admins. */
export async function requestTimeOff(
	ctx: OrgContext,
	input: { startsOn: string; endsOn: string; reason: string }
) {
	const me = await memberFor(ctx);
	if (!me) error(403, 'Only staff can request time off');
	if (input.endsOn < input.startsOn) error(400, 'End date is before the start date');
	const [row] = await db
		.insert(memberTimeOff)
		.values({
			organizationId: ctx.orgId,
			memberId: me.id,
			startsOn: input.startsOn,
			endsOn: input.endsOn,
			reason: input.reason,
			status: 'pending'
		})
		.returning();
	const { notifyTimeOffRequest } = await import('./notifications.ts');
	void notifyTimeOffRequest(
		ctx.orgId,
		me.id,
		input.startsOn === input.endsOn ? input.startsOn : `${input.startsOn} – ${input.endsOn}`,
		input.reason
	).catch((err) => console.error('time-off alert failed', err));
	return row;
}

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
	const approver = alias(user, 'time_entry_approver');
	const entries = await db
		.select({ entry: jobTimeEntry, memberName: user.name, approvedByName: approver.name })
		.from(jobTimeEntry)
		.leftJoin(member, eq(jobTimeEntry.memberId, member.id))
		.leftJoin(user, eq(member.userId, user.id))
		.leftJoin(approver, eq(jobTimeEntry.approvedById, approver.id))
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
	actorId?: string | null,
	geo?: { lat?: number; lng?: number }
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
		.values({
			organizationId: orgId,
			jobId,
			memberId,
			startedAt: new Date(),
			startLat: geo?.lat ?? null,
			startLng: geo?.lng ?? null
		})
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
export async function startTimer(
	ctx: OrgContext,
	jobId: string,
	geo?: { lat?: number; lng?: number }
) {
	const j = await requireJob(ctx.orgId, jobId);
	if (j.status === 'done' || j.status === 'cancelled') error(409, `Job is ${j.status}`);
	const me = await memberFor(ctx);
	if (!me) error(403, 'Only staff members can track time');
	return startTimerFor(ctx.orgId, jobId, me.id, ctx.userId, geo);
}

/** Closes the caller's open entry on the job; returns the closed entry, or null if none. */
export async function stopTimer(
	ctx: OrgContext,
	jobId: string,
	geo?: { lat?: number; lng?: number }
) {
	await requireJob(ctx.orgId, jobId);
	const me = await memberFor(ctx);
	if (!me) error(403, 'Only staff members can track time');
	const [row] = await db
		.update(jobTimeEntry)
		.set({ endedAt: new Date(), endLat: geo?.lat ?? null, endLng: geo?.lng ?? null })
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
			note: input.note ?? '',
			breakMin: input.breakMin ?? 0
		})
		.returning();
	return row;
}

/** Edits an entry's times/note. Members can edit their own; admin/owner can edit anyone's. */
export async function updateTimeEntry(
	ctx: OrgContext,
	tz: string,
	entryId: string,
	input: {
		startedAt: string;
		endedAt?: string | null;
		note?: string | null;
		breakMin?: number | null;
	}
) {
	const [row] = await db
		.select()
		.from(jobTimeEntry)
		.where(and(eq(jobTimeEntry.organizationId, ctx.orgId), eq(jobTimeEntry.id, entryId)));
	if (!row) error(404, 'Entry not found');
	const me = await memberFor(ctx);
	if (row.memberId !== me?.id && ctx.role === 'member') error(403, 'Admins only');
	if (row.lockedAt) error(409, 'Payroll period is locked — reopen it in Payroll first');
	const startedAt = zonedToUtc(input.startedAt, tz);
	const endedAt = input.endedAt ? zonedToUtc(input.endedAt, tz) : null;
	if (endedAt && endedAt <= startedAt) error(400, 'End must be after start');
	// Changing the recorded times (or the unpaid break) un-approves the entry —
	// an approval granted on one set of hours shouldn't survive a pay edit (also
	// stops a running entry from staying approved when its end is cleared). An
	// edit also clears any needs-fix flag — the member just addressed it.
	const breakMin = input.breakMin ?? 0;
	const timesChanged =
		row.startedAt.getTime() !== startedAt.getTime() ||
		(row.endedAt?.getTime() ?? null) !== (endedAt?.getTime() ?? null) ||
		row.breakMin !== breakMin;
	await db
		.update(jobTimeEntry)
		.set({
			startedAt,
			endedAt,
			note: input.note ?? '',
			breakMin,
			flaggedAt: null,
			...(timesChanged ? { approvedAt: null, approvedById: null } : {})
		})
		.where(eq(jobTimeEntry.id, entryId));
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
	if (row.lockedAt) error(409, 'Payroll period is locked — reopen it in Payroll first');
	await db.delete(jobTimeEntry).where(eq(jobTimeEntry.id, row.id));
}

/** Move a stop up/down in the tech's My Day order. Rewrites routeOrder for the
 * day's stops so the manual order stays consistent (null order = start-time order). */
export async function moveMyDayStop(
	ctx: OrgContext,
	tz: string,
	jobId: string,
	direction: 'up' | 'down'
) {
	const me = await memberFor(ctx);
	if (!me) error(403, 'Not a member of this organization');
	const today = localDate(new Date(), tz);
	const rows = await listJobs(ctx.orgId, {
		from: zonedToUtc(`${today}T00:00`, tz),
		to: zonedToUtc(`${addDays(today, 1)}T00:00`, tz),
		technicianId: me.id
	});
	rows.sort(
		(a, b) =>
			(a.job.routeOrder ?? Number.MAX_SAFE_INTEGER) -
				(b.job.routeOrder ?? Number.MAX_SAFE_INTEGER) ||
			(a.job.startsAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
				(b.job.startsAt?.getTime() ?? Number.MAX_SAFE_INTEGER)
	);
	const i = rows.findIndex((r) => r.job.id === jobId);
	if (i < 0) error(404, 'Job not found in today list');
	const j = direction === 'up' ? i - 1 : i + 1;
	if (j < 0 || j >= rows.length) return { moved: false };
	const ordered = rows.map((r) => r.job.id);
	[ordered[i], ordered[j]] = [ordered[j], ordered[i]];
	for (const [idx, id] of ordered.entries())
		await db
			.update(job)
			.set({ routeOrder: idx })
			.where(and(eq(job.organizationId, ctx.orgId), eq(job.id, id)));
	return { moved: true };
}

/** Approve/unapprove a time entry for payroll. Admin/owner only. */
/** Flag a time entry as needing a fix — admin-only; pings the member via inbox + email. */
export async function flagTimeEntry(ctx: OrgContext, entryId: string, note: string) {
	if (ctx.role === 'member') error(403, 'Admins only');
	const [row] = await db
		.update(jobTimeEntry)
		.set({ flaggedAt: new Date(), flagNote: note })
		.where(
			and(
				eq(jobTimeEntry.organizationId, ctx.orgId),
				eq(jobTimeEntry.id, entryId),
				isNull(jobTimeEntry.lockedAt)
			)
		)
		.returning();
	if (!row) error(404, 'Entry not found (or locked)');
	const { notifyTimeFlagged } = await import('./notifications.ts');
	void notifyTimeFlagged(ctx.orgId, row, ctx.userId).catch((err) =>
		console.error('time-flagged alert failed', err)
	);
	return row;
}

/** Clear a needs-fix flag without approving. */
export async function unflagTimeEntry(ctx: OrgContext, entryId: string) {
	if (ctx.role === 'member') error(403, 'Admins only');
	await db
		.update(jobTimeEntry)
		.set({ flaggedAt: null, flagNote: '' })
		.where(and(eq(jobTimeEntry.organizationId, ctx.orgId), eq(jobTimeEntry.id, entryId)));
}

export async function approveTimeEntry(ctx: OrgContext, entryId: string, approved: boolean) {
	if (ctx.role === 'member') error(403, 'Admins only');
	if (!approved) {
		const [existing] = await db
			.select({ lockedAt: jobTimeEntry.lockedAt })
			.from(jobTimeEntry)
			.where(and(eq(jobTimeEntry.organizationId, ctx.orgId), eq(jobTimeEntry.id, entryId)));
		if (existing?.lockedAt) error(409, 'Payroll period is locked — reopen it in Payroll first');
	}
	const [row] = await db
		.update(jobTimeEntry)
		.set({
			approvedAt: approved ? new Date() : null,
			approvedById: approved ? ctx.userId : null,
			...(approved ? { flaggedAt: null, flagNote: '' } : {})
		})
		.where(and(eq(jobTimeEntry.organizationId, ctx.orgId), eq(jobTimeEntry.id, entryId)))
		.returning();
	if (!row) error(404, 'Entry not found');
	if (approved) {
		const { notifyTimeApproved } = await import('./notifications.ts');
		void notifyTimeApproved(ctx.orgId, [row.id], ctx.userId).catch((err) =>
			console.error('time-approved inbox failed', err)
		);
	}
	return row;
}

/** Approve every finished, unapproved entry on a job — payroll batch. Admin/owner only. */
export async function approveAllTimeEntries(ctx: OrgContext, jobId: string) {
	if (ctx.role === 'member') error(403, 'Admins only');
	const rows = await db
		.update(jobTimeEntry)
		.set({ approvedAt: new Date(), approvedById: ctx.userId })
		.where(
			and(
				eq(jobTimeEntry.organizationId, ctx.orgId),
				eq(jobTimeEntry.jobId, jobId),
				isNull(jobTimeEntry.approvedAt),
				isNotNull(jobTimeEntry.endedAt)
			)
		)
		.returning({ id: jobTimeEntry.id });
	if (rows.length) {
		const { notifyTimeApproved } = await import('./notifications.ts');
		void notifyTimeApproved(
			ctx.orgId,
			rows.map((r) => r.id),
			ctx.userId
		).catch((err) => console.error('time-approved inbox failed', err));
	}
	return { approved: rows.length };
}

/** Org-wide time entries in a range for the payroll review page. Admin/owner only. */
export async function payrollHours(ctx: OrgContext, from: Date, to: Date) {
	if (ctx.role === 'member') error(403, 'Admins only');
	const approver = alias(user, 'payroll_approver');
	return db
		.select({
			entry: jobTimeEntry,
			memberName: user.name,
			approvedByName: approver.name,
			laborCostCents: member.laborCostCents,
			overtimePct: member.overtimePct,
			jobId: job.id,
			jobNumber: job.number,
			jobSummary: job.summary,
			customerName: customer.name
		})
		.from(jobTimeEntry)
		.leftJoin(member, eq(jobTimeEntry.memberId, member.id))
		.leftJoin(user, eq(member.userId, user.id))
		.leftJoin(approver, eq(jobTimeEntry.approvedById, approver.id))
		.leftJoin(job, eq(jobTimeEntry.jobId, job.id))
		.leftJoin(customer, eq(job.customerId, customer.id))
		.where(
			and(
				eq(jobTimeEntry.organizationId, ctx.orgId),
				gte(jobTimeEntry.startedAt, from),
				lt(jobTimeEntry.startedAt, to)
			)
		)
		.orderBy(asc(user.name), desc(jobTimeEntry.startedAt));
}

/** Bulk-approve one member's finished entries inside a range — payroll. Admin/owner only. */
export async function approveMemberTimeEntries(
	ctx: OrgContext,
	memberId: string,
	from: Date,
	to: Date
) {
	if (ctx.role === 'member') error(403, 'Admins only');
	const rows = await db
		.update(jobTimeEntry)
		.set({ approvedAt: new Date(), approvedById: ctx.userId })
		.where(
			and(
				eq(jobTimeEntry.organizationId, ctx.orgId),
				eq(jobTimeEntry.memberId, memberId),
				isNull(jobTimeEntry.approvedAt),
				isNull(jobTimeEntry.lockedAt),
				isNotNull(jobTimeEntry.endedAt),
				gte(jobTimeEntry.startedAt, from),
				lt(jobTimeEntry.startedAt, to)
			)
		)
		.returning({ id: jobTimeEntry.id });
	if (rows.length) {
		const { notifyTimeApproved } = await import('./notifications.ts');
		void notifyTimeApproved(
			ctx.orgId,
			rows.map((r) => r.id),
			ctx.userId
		).catch((err) => console.error('time-approved inbox failed', err));
	}
	return { approved: rows.length };
}

/** Bulk-approve every member's finished entries inside a range — the payroll 'Approve all'. */
export async function approveRangeTimeEntries(ctx: OrgContext, from: Date, to: Date) {
	if (ctx.role === 'member') error(403, 'Admins only');
	const rows = await db
		.update(jobTimeEntry)
		.set({ approvedAt: new Date(), approvedById: ctx.userId })
		.where(
			and(
				eq(jobTimeEntry.organizationId, ctx.orgId),
				isNull(jobTimeEntry.approvedAt),
				isNull(jobTimeEntry.lockedAt),
				isNotNull(jobTimeEntry.endedAt),
				gte(jobTimeEntry.startedAt, from),
				lt(jobTimeEntry.startedAt, to)
			)
		)
		.returning({ id: jobTimeEntry.id });
	if (rows.length) {
		const { notifyTimeApproved } = await import('./notifications.ts');
		void notifyTimeApproved(
			ctx.orgId,
			rows.map((r) => r.id),
			ctx.userId
		).catch((err) => console.error('time-approved inbox failed', err));
	}
	return { approved: rows.length };
}

/** Closes a payroll period: approves every pending finished entry in the range,
 * then locks all finished entries so hours can't shift after payout. */
export async function closePayrollPeriod(ctx: OrgContext, from: Date, to: Date) {
	if (ctx.role === 'member') error(403, 'Admins only');
	const { approved } = await approveRangeTimeEntries(ctx, from, to);
	const locked = await db
		.update(jobTimeEntry)
		.set({ lockedAt: new Date() })
		.where(
			and(
				eq(jobTimeEntry.organizationId, ctx.orgId),
				isNotNull(jobTimeEntry.endedAt),
				isNull(jobTimeEntry.lockedAt),
				gte(jobTimeEntry.startedAt, from),
				lt(jobTimeEntry.startedAt, to)
			)
		)
		.returning({ id: jobTimeEntry.id });
	return { approved, locked: locked.length };
}

/** Reopens a closed payroll period — clears the lock so entries can move again. */
export async function reopenPayrollPeriod(ctx: OrgContext, from: Date, to: Date) {
	if (ctx.role === 'member') error(403, 'Admins only');
	const rows = await db
		.update(jobTimeEntry)
		.set({ lockedAt: null })
		.where(
			and(
				eq(jobTimeEntry.organizationId, ctx.orgId),
				isNotNull(jobTimeEntry.lockedAt),
				gte(jobTimeEntry.startedAt, from),
				lt(jobTimeEntry.startedAt, to)
			)
		)
		.returning({ id: jobTimeEntry.id });
	return { reopened: rows.length };
}

/** Reorder a stop inside any technician's day — the dispatch-side twin of moveMyDayStop. */
export async function moveDayStop(
	ctx: OrgContext,
	tz: string,
	memberId: string,
	on: string,
	jobId: string,
	direction: 'up' | 'down'
) {
	const me = await memberFor(ctx);
	if (!me) error(403, 'Not a member of this organization');
	const rows = await listJobs(ctx.orgId, {
		from: zonedToUtc(`${on}T00:00`, tz),
		to: zonedToUtc(`${addDays(on, 1)}T00:00`, tz),
		technicianId: memberId
	});
	rows.sort(
		(a, b) =>
			(a.job.routeOrder ?? Number.MAX_SAFE_INTEGER) -
				(b.job.routeOrder ?? Number.MAX_SAFE_INTEGER) ||
			(a.job.startsAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
				(b.job.startsAt?.getTime() ?? Number.MAX_SAFE_INTEGER)
	);
	const i = rows.findIndex((r) => r.job.id === jobId);
	if (i < 0) error(404, 'Job not found in that day');
	const j = direction === 'up' ? i - 1 : i + 1;
	if (j < 0 || j >= rows.length) return { moved: false };
	const ordered = rows.map((r) => r.job.id);
	[ordered[i], ordered[j]] = [ordered[j], ordered[i]];
	for (const [idx, id] of ordered.entries())
		await db
			.update(job)
			.set({ routeOrder: idx })
			.where(and(eq(job.organizationId, ctx.orgId), eq(job.id, id)));
	return { moved: true };
}

// ---------- Dispatch board ----------

/** Jobs in the window plus everything unscheduled — one payload for the dispatch board. */
export async function dispatchBoard(orgId: string, from: Date, to: Date, officeId?: string) {
	const fromIso = from.toISOString().slice(0, 10);
	const toIso = to.toISOString().slice(0, 10);
	const pingCutoff = new Date(Date.now() - 7 * 86400_000);
	const [scheduled, unscheduled, technicians, timeOff, dayNotes, pingRows, waitlist] =
		await Promise.all([
			listJobs(orgId, { from, to, officeId }),
			listJobs(orgId, { unscheduled: true, officeId }),
			listTechnicians(orgId),
			db
				.select()
				.from(memberTimeOff)
				.where(
					and(
						eq(memberTimeOff.organizationId, orgId),
						eq(memberTimeOff.status, 'approved'),
						lte(memberTimeOff.startsOn, toIso),
						gte(memberTimeOff.endsOn, fromIso)
					)
				),
			db
				.select()
				.from(memberDayNote)
				.where(
					and(
						eq(memberDayNote.organizationId, orgId),
						gte(memberDayNote.on, fromIso),
						lte(memberDayNote.on, toIso)
					)
				),
			db
				.select({
					memberId: jobEvent.memberId,
					lat: jobEvent.lat,
					lng: jobEvent.lng,
					at: jobEvent.at
				})
				.from(jobEvent)
				.where(
					and(
						eq(jobEvent.organizationId, orgId),
						isNotNull(jobEvent.lat),
						isNotNull(jobEvent.memberId),
						gte(jobEvent.at, pingCutoff)
					)
				)
				.orderBy(desc(jobEvent.at))
				.limit(500),
			db
				.select({
					id: bookingWaitlist.id,
					name: bookingWaitlist.name,
					email: bookingWaitlist.email,
					phone: bookingWaitlist.phone,
					note: bookingWaitlist.note,
					status: bookingWaitlist.status,
					createdAt: bookingWaitlist.createdAt,
					jobTypeName: jobType.name
				})
				.from(bookingWaitlist)
				.leftJoin(jobType, eq(jobType.id, bookingWaitlist.jobTypeId))
				.where(
					and(
						eq(bookingWaitlist.organizationId, orgId),
						inArray(bookingWaitlist.status, ['new', 'contacted'])
					)
				)
				.orderBy(desc(bookingWaitlist.createdAt))
				.limit(100)
		]);
	const lastPing: Record<string, { lat: number; lng: number; at: Date }> = {};
	for (const r of pingRows)
		if (r.memberId && !lastPing[r.memberId])
			lastPing[r.memberId] = { lat: r.lat!, lng: r.lng!, at: r.at };
	return { scheduled, unscheduled, technicians, timeOff, dayNotes, lastPing, waitlist };
}

/** Staff triage for a waitlist signup: new → contacted → booked | closed. */
export async function setWaitlistStatus(orgId: string, id: string, status: string) {
	if (!['new', 'contacted', 'booked', 'closed'].includes(status)) error(400, 'Bad status');
	const [row] = await db
		.update(bookingWaitlist)
		.set({ status })
		.where(and(eq(bookingWaitlist.id, id), eq(bookingWaitlist.organizationId, orgId)))
		.returning();
	if (!row) error(404, 'Waitlist entry not found');
	return row;
}

/** Technicians = staff members of the org. */
export async function listTechnicians(orgId: string) {
	return db
		.select({
			id: member.id,
			name: user.name,
			skillTags: member.skillTags,
			color: member.color
		})
		.from(member)
		.innerJoin(user, eq(member.userId, user.id))
		.where(and(eq(member.organizationId, orgId), eq(member.dispatchVisible, true)))
		.orderBy(asc(user.name));
}

/** A technician's day: their jobs in the window, soonest first. */
export async function techDay(orgId: string, memberId: string, from: Date, to: Date) {
	return listJobs(orgId, { from, to, technicianId: memberId });
}

/** The calling technician's My Day payload: window jobs, their unscheduled queue, open timer. */
export async function myDay(ctx: OrgContext, from: Date, to: Date) {
	const me = await memberFor(ctx);
	const tz = (await getSettings(ctx.orgId)).timezone;
	const today = localDate(from, tz);
	if (!me)
		return {
			member: null,
			jobs: [],
			unscheduled: [],
			queue: [],
			overdue: [],
			tomorrow: [],
			openEntry: null,
			docs: [],
			materials: [],
			pendingApprovalMin: 0,
			flaggedTime: [],
			weekLoggedMin: 0,
			weekApprovedMin: 0,
			monthCommissionCents: 0,
			truckLow: [],
			tz,
			today
		};
	// Monday of the local week containing `from` — bounds the "this week" strip.
	const weekDow = new Date(`${today}T12:00:00Z`).getUTCDay();
	const weekStart = zonedToUtc(`${addDays(today, -((weekDow + 6) % 7))}T00:00`, tz);
	// First of the local month — bounds the commission estimate.
	const monthStart = zonedToUtc(`${today.slice(0, 7)}-01T00:00`, tz);
	const [
		jobs,
		unscheduled,
		queue,
		overdue,
		openEntries,
		dayEntries,
		tomorrow,
		offToday,
		dayNote,
		pendingApproval,
		weekSums,
		commissionSum,
		truckLow,
		flaggedTime
	] = await Promise.all([
		listJobs(ctx.orgId, { from, to, technicianId: me.id, orHelper: true }),
		listJobs(ctx.orgId, { technicianId: me.id, orHelper: true, status: ['unscheduled'] }),
		listJobs(ctx.orgId, { status: ['unscheduled'], unassigned: true }),
		listJobs(ctx.orgId, {
			to: from,
			technicianId: me.id,
			orHelper: true,
			status: ['scheduled', 'dispatched', 'in_progress']
		}),
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
			.limit(1),
		db
			.select({
				startedAt: jobTimeEntry.startedAt,
				endedAt: jobTimeEntry.endedAt
			})
			.from(jobTimeEntry)
			.where(
				and(
					eq(jobTimeEntry.organizationId, ctx.orgId),
					eq(jobTimeEntry.memberId, me.id),
					gte(jobTimeEntry.startedAt, from),
					lt(jobTimeEntry.startedAt, to)
				)
			),
		// Tomorrow's roster — jobs scheduled in the day after the [from,to) window.
		listJobs(ctx.orgId, {
			from: to,
			to: new Date(to.getTime() + 24 * 60 * 60 * 1000),
			technicianId: me.id
		}),
		// PTO covering today — shown as an off-day banner on My Day.
		db
			.select({ reason: memberTimeOff.reason })
			.from(memberTimeOff)
			.where(
				and(
					eq(memberTimeOff.organizationId, ctx.orgId),
					eq(memberTimeOff.memberId, me.id),
					eq(memberTimeOff.status, 'approved'),
					lte(memberTimeOff.startsOn, localDate(from, tz)),
					gte(memberTimeOff.endsOn, localDate(from, tz))
				)
			)
			.limit(1),
		// Dispatcher note pinned to today — banner on My Day.
		db
			.select({ note: memberDayNote.note })
			.from(memberDayNote)
			.where(
				and(
					eq(memberDayNote.organizationId, ctx.orgId),
					eq(memberDayNote.memberId, me.id),
					eq(memberDayNote.on, localDate(from, tz))
				)
			)
			.limit(1),
		// Own finished-but-unapproved minutes (30d) — the "awaiting approval" chip on My Day.
		db
			.select({
				minutes:
					sql<number>`coalesce(sum(extract(epoch from (${jobTimeEntry.endedAt} - ${jobTimeEntry.startedAt})) / 60), 0)`.mapWith(
						Number
					)
			})
			.from(jobTimeEntry)
			.where(
				and(
					eq(jobTimeEntry.organizationId, ctx.orgId),
					eq(jobTimeEntry.memberId, me.id),
					isNotNull(jobTimeEntry.endedAt),
					isNull(jobTimeEntry.approvedAt),
					gte(jobTimeEntry.startedAt, new Date(from.getTime() - 30 * 24 * 60 * 60 * 1000))
				)
			),
		// Own finished minutes this week, split by payroll approval — the "this week" strip.
		db
			.select({
				logged:
					sql<number>`coalesce(sum(extract(epoch from (${jobTimeEntry.endedAt} - ${jobTimeEntry.startedAt})) / 60), 0)`.mapWith(
						Number
					),
				approved:
					sql<number>`coalesce(sum(case when ${jobTimeEntry.approvedAt} is not null then extract(epoch from (${jobTimeEntry.endedAt} - ${jobTimeEntry.startedAt})) / 60 else 0 end), 0)`.mapWith(
						Number
					)
			})
			.from(jobTimeEntry)
			.where(
				and(
					eq(jobTimeEntry.organizationId, ctx.orgId),
					eq(jobTimeEntry.memberId, me.id),
					isNotNull(jobTimeEntry.endedAt),
					gte(jobTimeEntry.startedAt, weekStart)
				)
			),
		// Collected payments this month on jobs assigned to me — feeds the
		// commission estimate chip (member.commissionPct applied on the total).
		db
			.select({
				total: sql<number>`coalesce(sum(${payment.amount}), 0)`.mapWith(Number)
			})
			.from(payment)
			.innerJoin(charge, eq(payment.chargeId, charge.id))
			.innerJoin(job, eq(charge.jobId, job.id))
			.where(
				and(
					eq(payment.organizationId, ctx.orgId),
					eq(job.technicianId, me.id),
					gte(payment.paidAt, monthStart)
				)
			),
		// Truck items at/below the warehouse reorder point — low-stock chip on My Day.
		db
			.select({
				name: inventoryItem.name,
				unit: inventoryItem.unit,
				qty: truckStock.qty,
				reorderPoint: inventoryItem.reorderPoint
			})
			.from(truckStock)
			.innerJoin(inventoryItem, eq(truckStock.inventoryItemId, inventoryItem.id))
			.where(
				and(
					eq(truckStock.organizationId, ctx.orgId),
					eq(truckStock.memberId, me.id),
					sql`${inventoryItem.reorderPoint} is not null`,
					sql`${truckStock.qty} <= ${inventoryItem.reorderPoint}`
				)
			)
			.orderBy(asc(truckStock.qty))
			.limit(10),
		// Entries flagged "needs fix" — surfaced as a chip so the tech goes and corrects them.
		db
			.select({
				id: jobTimeEntry.id,
				jobId: jobTimeEntry.jobId,
				jobNumber: job.number,
				note: jobTimeEntry.flagNote
			})
			.from(jobTimeEntry)
			.innerJoin(job, eq(jobTimeEntry.jobId, job.id))
			.where(
				and(
					eq(jobTimeEntry.organizationId, ctx.orgId),
					eq(jobTimeEntry.memberId, me.id),
					isNotNull(jobTimeEntry.flaggedAt)
				)
			)
	]);
	// Tech's manual stop order (route_order) takes precedence over the start-time sort.
	jobs.sort(
		(a, b) =>
			(a.job.routeOrder ?? Number.MAX_SAFE_INTEGER) -
				(b.job.routeOrder ?? Number.MAX_SAFE_INTEGER) ||
			(a.job.startsAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
				(b.job.startsAt?.getTime() ?? Number.MAX_SAFE_INTEGER)
	);
	const docJobIds = [...new Set([...jobs, ...overdue].map((r) => r.job.id))];
	const docs = docJobIds.length
		? await db
				.select({ id: jobDocument.id, jobId: jobDocument.jobId, fileName: jobDocument.fileName })
				.from(jobDocument)
				.where(
					and(eq(jobDocument.organizationId, ctx.orgId), inArray(jobDocument.jobId, docJobIds))
				)
				.orderBy(asc(jobDocument.createdAt))
		: [];

	const materials = jobs.length
		? await db
				.select({
					name: inventoryItem.name,
					unit: inventoryItem.unit,
					sku: inventoryItem.sku,
					qty: sql<number>`sum(${jobMaterial.qty})`.mapWith(Number)
				})
				.from(jobMaterial)
				.innerJoin(inventoryItem, eq(jobMaterial.inventoryItemId, inventoryItem.id))
				.where(
					and(
						eq(jobMaterial.organizationId, ctx.orgId),
						inArray(
							jobMaterial.jobId,
							jobs.map((j) => j.job.id)
						)
					)
				)
				.groupBy(inventoryItem.id, inventoryItem.name, inventoryItem.unit, inventoryItem.sku)
				.orderBy(asc(inventoryItem.name))
		: [];

	const now = Date.now();
	const minutesLogged = Math.round(
		dayEntries.reduce(
			(sum, e) => sum + ((e.endedAt?.getTime() ?? now) - e.startedAt.getTime()) / 60000,
			0
		)
	);
	return {
		member: me,
		tz,
		today,
		jobs,
		unscheduled,
		queue,
		overdue,
		openEntry: openEntries[0] ?? null,
		minutesLogged,
		tomorrow,
		offToday: offToday[0] ?? null,
		dayNote: dayNote[0]?.note ?? '',
		pendingApprovalMin: Math.round(pendingApproval[0]?.minutes ?? 0),
		weekLoggedMin: Math.round(weekSums[0]?.logged ?? 0),
		weekApprovedMin: Math.round(weekSums[0]?.approved ?? 0),
		monthCommissionCents: Math.round(
			((commissionSum[0]?.total ?? 0) * (me.commissionPct ?? 0)) / 100
		),
		docs,
		materials,
		truckLow,
		flaggedTime
	};
}

export { addDays };

/** Org-wide time entries for the REST API (newest first, capped). */
export async function listOrgTimeEntries(
	orgId: string,
	opts: { jobId?: string; memberId?: string; limit?: number }
) {
	return db
		.select({ entry: jobTimeEntry, memberName: user.name, jobNumber: job.number })
		.from(jobTimeEntry)
		.leftJoin(member, eq(jobTimeEntry.memberId, member.id))
		.leftJoin(user, eq(member.userId, user.id))
		.leftJoin(job, eq(jobTimeEntry.jobId, job.id))
		.where(
			and(
				eq(jobTimeEntry.organizationId, orgId),
				opts.jobId ? eq(jobTimeEntry.jobId, opts.jobId) : undefined,
				opts.memberId ? eq(jobTimeEntry.memberId, opts.memberId) : undefined
			)
		)
		.orderBy(desc(jobTimeEntry.startedAt))
		.limit(opts.limit ?? 500);
}

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
	// Time-off blocks when it covers the start day OR any later day in a multi-day span.
	const endDay = end ? localDate(end, tz) : day;
	const [block] = await db
		.select({ startsOn: memberTimeOff.startsOn, endsOn: memberTimeOff.endsOn, name: user.name })
		.from(memberTimeOff)
		.innerJoin(member, eq(memberTimeOff.memberId, member.id))
		.innerJoin(user, eq(member.userId, user.id))
		.where(
			and(
				eq(memberTimeOff.organizationId, orgId),
				eq(memberTimeOff.memberId, memberId),
				eq(memberTimeOff.status, 'approved'),
				lte(memberTimeOff.startsOn, endDay),
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

/** Admin approves or denies a pending time-off request. */
export async function setTimeOffStatus(ctx: OrgContext, id: string, status: 'approved' | 'denied') {
	const [row] = await db
		.update(memberTimeOff)
		.set({ status })
		.where(and(eq(memberTimeOff.id, id), eq(memberTimeOff.organizationId, ctx.orgId)))
		.returning();
	if (!row) error(404, 'Request not found');
	// Approving doesn't move jobs already scheduled inside the window — return
	// them so the admin gets warned and can reassign on the dispatch board.
	let conflicts: { id: string; number: number; startsAt: Date | null }[] = [];
	if (status === 'approved') {
		const tz = (await getSettings(ctx.orgId)).timezone;
		const dayStart = zonedToUtc(`${row.startsOn}T00:00`, tz);
		const dayEnd = zonedToUtc(`${addDays(row.endsOn, 1)}T00:00`, tz);
		conflicts = await db
			.select({ id: job.id, number: job.number, startsAt: job.startsAt })
			.from(job)
			.where(
				and(
					eq(job.organizationId, ctx.orgId),
					eq(job.technicianId, row.memberId),
					inArray(job.status, ['scheduled', 'dispatched', 'in_progress']),
					lt(job.startsAt, dayEnd),
					sql`coalesce(${job.endsAt}, ${job.startsAt}) >= ${dayStart.toISOString()}`
				)
			)
			.orderBy(asc(job.startsAt));
	}
	return { row, conflicts };
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
					warranty: src.job.warranty,
					arrivalWindow: null,
					startsAt
				},
				{ source: src.job.source ?? 'manual' }
			)
		);
	}
	return made;
}

const PRIO_RANK: Record<string, number> = { low: 0, normal: 1, high: 2, urgent: 3 };

/** Daily cron: escalate the priority of jobs sitting in the unscheduled queue too long. */
export async function runJobEscalation(orgId: string) {
	const rows = await db
		.select({ id: job.id, number: job.number, priority: job.priority, createdAt: job.createdAt })
		.from(job)
		.where(and(eq(job.organizationId, orgId), eq(job.status, 'unscheduled')));
	const now = Date.now();
	for (const j of rows) {
		const days = (now - j.createdAt.getTime()) / 86400_000;
		const target = days >= 14 ? 'urgent' : days >= 7 ? 'high' : null;
		if (!target || (PRIO_RANK[target] ?? 0) <= (PRIO_RANK[j.priority] ?? 1)) continue;
		await db.update(job).set({ priority: target }).where(eq(job.id, j.id));
		await emit({
			orgId,
			entityType: 'job',
			entityId: j.id,
			action: 'escalated',
			summary: `J-${j.number} auto-escalated to ${target} (${Math.floor(days)}d in queue)`
		});
	}
}

/** Job timeline events for the REST API (optionally filtered to one job). */
export async function listJobEvents(orgId: string, jobId?: string | null) {
	return db
		.select({ event: jobEvent, memberName: user.name })
		.from(jobEvent)
		.leftJoin(member, eq(jobEvent.memberId, member.id))
		.leftJoin(user, eq(member.userId, user.id))
		.where(and(eq(jobEvent.organizationId, orgId), jobId ? eq(jobEvent.jobId, jobId) : undefined))
		.orderBy(desc(jobEvent.at))
		.limit(500);
}

// ---------- Public service report ----------

function signReport(payload: string) {
	return createHmac('sha256', BETTER_AUTH_SECRET).update(`report:${payload}`).digest('base64url');
}

/** Stateless signed link to the public visit report (`/r/<id>.<sig>`). */
export function serviceReportToken(jobId: string) {
	return `${jobId}.${signReport(jobId)}`;
}

export function verifyServiceReportToken(token: string) {
	const m = /^([0-9a-f-]{36})\.([\w-]+)$/.exec(token.trim());
	if (!m) return null;
	const [, jobId, sig] = m;
	const expected = Buffer.from(signReport(jobId!));
	const got = Buffer.from(sig!);
	return expected.length === got.length && timingSafeEqual(expected, got) ? jobId : null;
}

export function serviceReportUrl(id: string) {
	return `${appOrigin()}/r/${serviceReportToken(id)}`;
}

function signCancel(payload: string) {
	return createHmac('sha256', BETTER_AUTH_SECRET).update(`cancel:${payload}`).digest('base64url');
}

export function bookingCancelToken(jobId: string) {
	return `${jobId}.${signCancel(jobId)}`;
}

export function verifyBookingCancelToken(token: string) {
	const m = /^([^.]+)\.([A-Za-z0-9_-]+)$/.exec(token);
	if (!m) return null;
	const [, jobId, sig] = m;
	const expected = Buffer.from(signCancel(jobId!));
	const got = Buffer.from(sig!);
	return expected.length === got.length && timingSafeEqual(expected, got) ? jobId! : null;
}

export function bookingCancelUrl(jobId: string) {
	return `${appOrigin()}/book/cancel/${bookingCancelToken(jobId)}`;
}

/** Public cancel from the emailed link: flips the job to cancelled and notifies staff. */
export async function cancelBookedJob(jobId: string) {
	const [j] = await db.select().from(job).where(eq(job.id, jobId)).limit(1);
	if (!j) error(404, 'Visit not found');
	if (j.status === 'cancelled' || j.cancelledAt) return { job: j, already: true };
	if (j.status === 'done' || j.status === 'in_progress')
		error(409, 'This visit can no longer be cancelled online — please call us.');
	const [updated] = await db
		.update(job)
		.set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: 'Cancelled by customer' })
		.where(eq(job.id, jobId))
		.returning();
	await emit({
		orgId: j.organizationId,
		entityType: 'job',
		entityId: jobId,
		action: 'cancelled',
		summary: `Visit J-${j.number} cancelled by the customer via the booking link`
	});
	const { notifyBookingCancelled } = await import('./notifications.ts');
	await notifyBookingCancelled(j.organizationId, jobId);
	return { job: updated!, already: false };
}

/** What the public /r/[token] page shows — a completed visit's customer-facing summary. */
export async function publicServiceReport(id: string) {
	const [row] = await db
		.select({
			job,
			customerName: customer.name,
			techName: user.name,
			typeName: jobType.name,
			location: serviceLocation
		})
		.from(job)
		.innerJoin(customer, eq(job.customerId, customer.id))
		.leftJoin(serviceLocation, eq(job.serviceLocationId, serviceLocation.id))
		.leftJoin(jobType, eq(job.jobTypeId, jobType.id))
		.leftJoin(member, eq(job.technicianId, member.id))
		.leftJoin(user, eq(member.userId, user.id))
		.where(and(eq(job.id, id), eq(job.status, 'done')));
	if (!row) error(404, 'Report not found');
	const settings = await getSettings(row.job.organizationId);
	const checklist = await db
		.select()
		.from(jobChecklistItem)
		.where(eq(jobChecklistItem.jobId, id))
		.orderBy(asc(jobChecklistItem.sort));
	const materials = await db
		.select({
			name: inventoryItem.name,
			unit: inventoryItem.unit,
			qty: jobMaterial.qty,
			unitPrice: jobMaterial.unitPrice
		})
		.from(jobMaterial)
		.innerJoin(inventoryItem, eq(jobMaterial.inventoryItemId, inventoryItem.id))
		.where(eq(jobMaterial.jobId, id))
		.orderBy(asc(jobMaterial.createdAt));
	const photos = await db
		.select({ id: jobPhoto.id, phase: jobPhoto.phase, fileName: jobPhoto.fileName })
		.from(jobPhoto)
		.where(and(eq(jobPhoto.jobId, id), eq(jobPhoto.shared, true)))
		.orderBy(asc(jobPhoto.createdAt));
	return {
		job: row.job,
		customerName: row.customerName,
		techName: row.techName,
		typeName: row.typeName,
		location: row.location,
		orgName: settings.orgName,
		orgLogoUrl: settings.logoUrl,
		currency: settings.currency,
		checklist,
		materials,
		photos
	};
}

/**
 * Staff answers a customer's portal cancellation request. Approve cancels the
 * visit through the normal cancel path (timers stopped, customer notified);
 * decline keeps it and tells the customer it's still on.
 */
export async function resolveVisitCancel(ctx: OrgContext, jobId: string, approve: boolean) {
	const [j] = await db
		.select()
		.from(job)
		.where(and(eq(job.organizationId, ctx.orgId), eq(job.id, jobId), isNull(job.cancelledAt)));
	if (!j) error(404, 'Job not found');
	const [req] = await db
		.select({ id: jobEvent.id })
		.from(jobEvent)
		.where(
			and(
				eq(jobEvent.jobId, jobId),
				eq(jobEvent.kind, 'note'),
				like(jobEvent.note, 'Customer requested cancellation%')
			)
		)
		.orderBy(desc(jobEvent.at))
		.limit(1);
	if (!req) error(409, 'No pending cancellation request');
	const [handled] = await db
		.select({ id: jobEvent.id })
		.from(jobEvent)
		.where(
			and(
				eq(jobEvent.jobId, jobId),
				eq(jobEvent.kind, 'note'),
				like(jobEvent.note, 'Cancellation request %')
			)
		)
		.limit(1);
	if (handled) error(409, 'Cancellation request already handled');

	const me = await memberFor(ctx);
	if (approve) {
		const tz = (await getSettings(ctx.orgId)).timezone;
		await updateJob(ctx, tz, {
			id: jobId,
			cancelled: true,
			cancelReason: 'Customer request'
		});
		await db.insert(jobEvent).values({
			organizationId: ctx.orgId,
			jobId,
			kind: 'note',
			memberId: me?.id ?? null,
			note: 'Cancellation request approved — visit cancelled'
		});
		return { approved: true };
	}
	await db.insert(jobEvent).values({
		organizationId: ctx.orgId,
		jobId,
		kind: 'note',
		memberId: me?.id ?? null,
		note: 'Cancellation request declined — visit stays scheduled'
	});
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'job',
		entityId: jobId,
		action: 'cancel_declined',
		summary: `J-${j.number} cancellation request declined`
	});
	const { notifyVisitCancelDeclined } = await import('./notifications.ts');
	notifyVisitCancelDeclined(ctx.orgId, jobId).catch((err) =>
		console.error('cancel-declined notify failed', err)
	);
	return { approved: false };
}

// ---------- Member profile ----------

/** One staff member's detail page: profile, 30-day stats, upcoming jobs, recent time, PTO. */
export async function memberProfile(orgId: string, memberId: string) {
	const [m] = await db
		.select({
			id: member.id,
			userId: user.id,
			name: user.name,
			email: user.email,
			image: user.image,
			role: member.role,
			commissionPct: member.commissionPct,
			laborCostCents: member.laborCostCents,
			overtimePct: member.overtimePct,
			staffAlerts: member.staffAlerts,
			phone: member.phone,
			skillTags: member.skillTags,
			color: member.color,
			dispatchVisible: member.dispatchVisible,
			licenseNo: member.licenseNo,
			licenseExpiry: member.licenseExpiry,
			createdAt: member.createdAt
		})
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.where(and(eq(member.organizationId, orgId), eq(member.id, memberId)));
	if (!m) error(404, 'Member not found');
	const tz = (await getSettings(orgId)).timezone;
	const today = localDate(new Date(), tz);
	const cut30 = new Date(Date.now() - 30 * 86400_000);
	const [entries, stats, rating, upcoming, recentDone, timeOff] = await Promise.all([
		db
			.select({
				id: jobTimeEntry.id,
				jobId: jobTimeEntry.jobId,
				jobNumber: job.number,
				jobSummary: job.summary,
				startedAt: jobTimeEntry.startedAt,
				endedAt: jobTimeEntry.endedAt,
				breakMin: jobTimeEntry.breakMin,
				note: jobTimeEntry.note
			})
			.from(jobTimeEntry)
			.innerJoin(job, eq(jobTimeEntry.jobId, job.id))
			.where(and(eq(jobTimeEntry.organizationId, orgId), eq(jobTimeEntry.memberId, memberId)))
			.orderBy(desc(jobTimeEntry.startedAt))
			.limit(15),
		db
			.select({
				done30:
					sql<number>`count(*) filter (where ${job.status} = 'done' and ${job.completedAt} >= ${cut30.toISOString()})`.mapWith(
						Number
					),
				minutes30:
					sql<number>`coalesce((select sum(extract(epoch from (coalesce(te.ended_at, now()) - te.started_at)) / 60 - te.break_min) from ${jobTimeEntry} te where te.member_id = ${outer(job.technicianId)} and te.started_at >= ${cut30.toISOString()}), 0)`.mapWith(
						Number
					)
			})
			.from(job)
			.where(and(eq(job.organizationId, orgId), eq(job.technicianId, memberId)))
			.groupBy(job.technicianId),
		db
			.select({
				avg: sql<number>`avg(${job.rating})`.mapWith(Number),
				n: sql<number>`count(*)`.mapWith(Number)
			})
			.from(job)
			.where(
				and(eq(job.organizationId, orgId), eq(job.technicianId, memberId), isNotNull(job.rating))
			),
		listJobs(orgId, {
			from: zonedToUtc(`${today}T00:00`, tz),
			to: zonedToUtc(`${addDays(today, 14)}T00:00`, tz),
			technicianId: memberId,
			orHelper: true
		}),
		db
			.select({
				id: job.id,
				number: job.number,
				summary: job.summary,
				completedAt: job.completedAt,
				rating: job.rating,
				customerName: customer.name
			})
			.from(job)
			.innerJoin(customer, eq(job.customerId, customer.id))
			.where(
				and(eq(job.organizationId, orgId), eq(job.technicianId, memberId), eq(job.status, 'done'))
			)
			.orderBy(desc(job.completedAt))
			.limit(10),
		db
			.select()
			.from(memberTimeOff)
			.where(
				and(
					eq(memberTimeOff.organizationId, orgId),
					eq(memberTimeOff.memberId, memberId),
					gte(memberTimeOff.endsOn, today)
				)
			)
			.orderBy(asc(memberTimeOff.startsOn))
	]);
	return {
		member: m,
		done30: stats[0]?.done30 ?? 0,
		minutes30: Math.max(0, Math.round(stats[0]?.minutes30 ?? 0)),
		avgRating: rating[0]?.avg ?? null,
		ratingCount: rating[0]?.n ?? 0,
		upcoming,
		recentDone,
		entries,
		timeOff
	};
}
