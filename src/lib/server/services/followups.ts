import { error } from '@sveltejs/kit';
import { and, asc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { customer, followUp, job, member, memberDayNote, user } from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import { emit } from './events.ts';
import type * as s from '#lib/schemas.ts';
import type * as v from 'valibot';

const caller = async (ctx: OrgContext) =>
	(
		await db
			.select({ id: member.id })
			.from(member)
			.where(and(eq(member.organizationId, ctx.orgId), eq(member.userId, ctx.userId)))
	)[0];

const followUpSelect = {
	id: followUp.id,
	note: followUp.note,
	dueOn: followUp.dueOn,
	doneAt: followUp.doneAt,
	memberId: followUp.memberId,
	customerId: followUp.customerId,
	jobId: followUp.jobId,
	assignee: user.name,
	customerName: customer.name,
	jobNumber: job.number
};

const followUpQuery = () =>
	db
		.select(followUpSelect)
		.from(followUp)
		.innerJoin(member, eq(followUp.memberId, member.id))
		.innerJoin(user, eq(member.userId, user.id))
		.leftJoin(customer, eq(followUp.customerId, customer.id))
		.leftJoin(job, eq(followUp.jobId, job.id));

/** Open-then-done follow-ups (open first, soonest due first), scoped when given. */
export async function listFollowUps(orgId: string, opts?: { customerId?: string; jobId?: string }) {
	return followUpQuery()
		.where(
			and(
				eq(followUp.organizationId, orgId),
				opts?.customerId ? eq(followUp.customerId, opts.customerId) : undefined,
				opts?.jobId ? eq(followUp.jobId, opts.jobId) : undefined
			)
		)
		.orderBy(sql`case when ${followUp.doneAt} is null then 0 else 1 end`, asc(followUp.dueOn));
}

export async function addFollowUp(ctx: OrgContext, input: v.InferOutput<typeof s.followUpInput>) {
	const me = await caller(ctx);
	if (!me) error(403, 'Not a member of this organization');
	const memberId = input.memberId || me.id;
	if (memberId !== me.id) {
		const [m] = await db
			.select({ id: member.id })
			.from(member)
			.where(and(eq(member.organizationId, ctx.orgId), eq(member.id, memberId)));
		if (!m) error(400, 'Assignee is not in this organization');
	}
	const [row] = await db
		.insert(followUp)
		.values({
			organizationId: ctx.orgId,
			memberId,
			customerId: input.customerId ?? null,
			jobId: input.jobId ?? null,
			note: input.note,
			dueOn: input.dueOn
		})
		.returning();
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'follow_up',
		entityId: row!.id,
		action: 'created',
		summary: `Follow-up due ${row!.dueOn}`
	});
	return row;
}

export async function completeFollowUp(ctx: OrgContext, id: string) {
	const [row] = await db
		.update(followUp)
		.set({ doneAt: new Date() })
		.where(and(eq(followUp.organizationId, ctx.orgId), eq(followUp.id, id)))
		.returning();
	if (!row) error(404, 'Follow-up not found');
	return row;
}

export async function removeFollowUp(ctx: OrgContext, id: string) {
	const [row] = await db
		.delete(followUp)
		.where(and(eq(followUp.organizationId, ctx.orgId), eq(followUp.id, id)))
		.returning();
	if (!row) error(404, 'Follow-up not found');
	return row;
}

/** Open follow-ups due on or before `todayIso` — dashboard attention + daily reminder run. */
export async function dueFollowUps(orgId: string, todayIso: string) {
	return followUpQuery()
		.where(
			and(
				eq(followUp.organizationId, orgId),
				isNull(followUp.doneAt),
				lte(followUp.dueOn, todayIso)
			)
		)
		.orderBy(asc(followUp.dueOn));
}

/** Upsert a dispatcher's note for a tech+day; an empty note clears it. */
export async function setDayNote(ctx: OrgContext, input: v.InferOutput<typeof s.dayNoteInput>) {
	const [m] = await db
		.select({ id: member.id })
		.from(member)
		.where(and(eq(member.organizationId, ctx.orgId), eq(member.id, input.memberId)));
	if (!m) error(400, 'Technician is not in this organization');
	if (!input.note) {
		await db
			.delete(memberDayNote)
			.where(
				and(
					eq(memberDayNote.organizationId, ctx.orgId),
					eq(memberDayNote.memberId, input.memberId),
					eq(memberDayNote.on, input.on)
				)
			);
		return null;
	}
	const [row] = await db
		.insert(memberDayNote)
		.values({
			organizationId: ctx.orgId,
			memberId: input.memberId,
			on: input.on,
			note: input.note
		})
		.onConflictDoUpdate({
			target: [memberDayNote.memberId, memberDayNote.on],
			set: { note: input.note, updatedAt: new Date() }
		})
		.returning();
	return row;
}

/** Day notes overlapping a window — badges on the dispatch board. */
export async function dayNotes(orgId: string, fromIso: string, toIso: string) {
	return db
		.select()
		.from(memberDayNote)
		.where(
			and(
				eq(memberDayNote.organizationId, orgId),
				gte(memberDayNote.on, fromIso),
				lte(memberDayNote.on, toIso)
			)
		);
}
