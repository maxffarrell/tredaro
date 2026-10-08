import { error } from '@sveltejs/kit';
import { and, asc, eq, lte } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	customer,
	job,
	jobChecklistItem,
	jobType,
	maintenanceSchedule
} from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import type * as s from '#lib/schemas.ts';
import type * as v from 'valibot';
import { emit } from './events.ts';
import { nextNumber } from './settings.ts';

export async function listSchedules(orgId: string, customerId?: string) {
	return db
		.select({
			schedule: maintenanceSchedule,
			customerName: customer.name,
			jobTypeName: jobType.name
		})
		.from(maintenanceSchedule)
		.innerJoin(customer, eq(maintenanceSchedule.customerId, customer.id))
		.leftJoin(jobType, eq(maintenanceSchedule.jobTypeId, jobType.id))
		.where(
			and(
				eq(maintenanceSchedule.organizationId, orgId),
				customerId ? eq(maintenanceSchedule.customerId, customerId) : undefined
			)
		)
		.orderBy(asc(maintenanceSchedule.nextDueOn));
}

export async function createSchedule(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.scheduleInput>
) {
	const [c] = await db
		.select({ id: customer.id })
		.from(customer)
		.where(and(eq(customer.id, input.customerId), eq(customer.organizationId, ctx.orgId)))
		.limit(1);
	if (!c) error(404, 'Customer not found');
	if (input.jobTypeId) {
		const [t] = await db
			.select({ id: jobType.id })
			.from(jobType)
			.where(and(eq(jobType.id, input.jobTypeId), eq(jobType.organizationId, ctx.orgId)))
			.limit(1);
		if (!t) error(404, 'Job type not found');
	}
	const [row] = await db
		.insert(maintenanceSchedule)
		.values({
			organizationId: ctx.orgId,
			customerId: input.customerId,
			jobTypeId: input.jobTypeId ?? null,
			summary: input.summary ?? '',
			intervalDays: input.intervalDays,
			nextDueOn: input.nextDueOn,
			active: input.active
		})
		.returning();
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'maintenance_schedule',
		entityId: row.id,
		action: 'created',
		summary: 'Maintenance schedule created'
	});
	return row;
}

export async function updateSchedule(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.scheduleUpdate>
) {
	const { id, ...set } = input;
	const [row] = await db
		.update(maintenanceSchedule)
		.set({ ...set, updatedAt: new Date() })
		.where(and(eq(maintenanceSchedule.id, id), eq(maintenanceSchedule.organizationId, ctx.orgId)))
		.returning();
	if (!row) error(404, 'Schedule not found');
	return row;
}

export async function deleteSchedule(ctx: OrgContext, id: string) {
	const [row] = await db
		.delete(maintenanceSchedule)
		.where(and(eq(maintenanceSchedule.id, id), eq(maintenanceSchedule.organizationId, ctx.orgId)))
		.returning();
	if (!row) error(404, 'Schedule not found');
	return row;
}

/**
 * Generates unscheduled jobs for due maintenance schedules and rolls `nextDueOn`
 * forward. Idempotent via `job_schedule_period_idx`. Runs from /api/cron and
 * opportunistically when staff open the app.
 */
export async function runSchedules(orgId: string) {
	const today = new Date().toISOString().slice(0, 10);
	const due = await db
		.select({
			schedule: maintenanceSchedule,
			jobTypeName: jobType.name,
			checklist: jobType.checklist
		})
		.from(maintenanceSchedule)
		.leftJoin(jobType, eq(maintenanceSchedule.jobTypeId, jobType.id))
		.where(
			and(
				eq(maintenanceSchedule.organizationId, orgId),
				eq(maintenanceSchedule.active, true),
				lte(maintenanceSchedule.nextDueOn, today)
			)
		);
	let created = 0;
	for (const { schedule: sc, jobTypeName, checklist } of due) {
		let period = sc.nextDueOn;
		let lastCreated = false;
		// Catch up on any missed periods; the unique index dedupes re-runs.
		while (period <= today) {
			const number = await nextNumber(orgId, 'job');
			const [row] = await db
				.insert(job)
				.values({
					organizationId: orgId,
					number,
					customerId: sc.customerId,
					jobTypeId: sc.jobTypeId,
					summary:
						sc.summary || (jobTypeName ? `${jobTypeName} (maintenance)` : 'Maintenance visit'),
					status: 'unscheduled',
					source: 'maintenance',
					maintenanceScheduleId: sc.id,
					schedulePeriod: period
				})
				.onConflictDoNothing({ target: [job.maintenanceScheduleId, job.schedulePeriod] })
				.returning({ id: job.id });
			if (row) {
				created++;
				lastCreated = true;
				if (checklist?.length)
					await db.insert(jobChecklistItem).values(
						checklist.map((label, i) => ({
							organizationId: orgId,
							jobId: row.id,
							label,
							sort: i
						}))
					);
			}
			const next = new Date(`${period}T00:00:00Z`);
			next.setUTCDate(next.getUTCDate() + sc.intervalDays);
			period = next.toISOString().slice(0, 10);
		}
		await db
			.update(maintenanceSchedule)
			.set({ nextDueOn: period, updatedAt: new Date() })
			.where(eq(maintenanceSchedule.id, sc.id));
		if (lastCreated)
			await emit({
				orgId,
				entityType: 'maintenance_schedule',
				entityId: sc.id,
				action: 'jobs_created',
				summary: `Maintenance visit${created === 1 ? '' : 's'} added to the unscheduled queue`
			});
	}
	return created;
}
