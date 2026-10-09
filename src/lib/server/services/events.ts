import { createHmac } from 'node:crypto';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { activity, user, webhook } from '#lib/server/db/schema.ts';

export type EventInput = {
	orgId: string;
	actorId?: string | null;
	entityType: string;
	entityId: string;
	action: string;
	summary: string;
	data?: Record<string, unknown>;
};

/** Records an activity entry and fans the event out to webhooks and integrations. */
export async function emit(e: EventInput) {
	const [row] = await db
		.insert(activity)
		.values({
			organizationId: e.orgId,
			actorId: e.actorId ?? null,
			entityType: e.entityType,
			entityId: e.entityId,
			action: e.action,
			summary: e.summary,
			data: e.data
		})
		.returning();

	const event = {
		id: row!.id,
		type: `${e.entityType}.${e.action}`,
		organizationId: e.orgId,
		entity: { type: e.entityType, id: e.entityId },
		summary: e.summary,
		data: e.data ?? {},
		createdAt: row!.createdAt.toISOString()
	};

	void deliverWebhooks(event).catch((err) => console.error('webhook delivery failed', err));
}

export type TredaroEvent = {
	id: string;
	type: string;
	organizationId: string;
	entity: { type: string; id: string };
	summary: string;
	data: Record<string, unknown>;
	createdAt: string;
};

export function signPayload(secret: string, body: string) {
	return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

async function deliverWebhooks(event: TredaroEvent) {
	const hooks = await db
		.select()
		.from(webhook)
		.where(and(eq(webhook.organizationId, event.organizationId), eq(webhook.enabled, true)));

	await Promise.allSettled(
		hooks
			.filter((h) => h.events.includes('*') || h.events.includes(event.type))
			.map(async (h) => {
				const body = JSON.stringify(event);
				let status = 0;
				try {
					const res = await fetch(h.url, {
						method: 'POST',
						headers: {
							'content-type': 'application/json',
							'x-tredaro-event': event.type,
							'x-tredaro-signature': signPayload(h.secret, body)
						},
						body,
						signal: AbortSignal.timeout(10_000)
					});
					status = res.status;
				} finally {
					await db
						.update(webhook)
						.set({ lastDeliveryAt: new Date(), lastDeliveryStatus: status })
						.where(eq(webhook.id, h.id));
				}
			})
	);
}

// ---------- feed ----------

/** Recent org activity for the /activity page — newest first, optional entity-type filter. */
export async function listActivity(
	orgId: string,
	entityType?: string,
	entityId?: string,
	limit = 200,
	actorId?: string
) {
	const rows = await db
		.select({
			activity,
			actorName: user.name,
			actorEmail: user.email
		})
		.from(activity)
		.leftJoin(user, eq(activity.actorId, user.id))
		.where(
			and(
				eq(activity.organizationId, orgId),
				entityType ? eq(activity.entityType, entityType) : undefined,
				entityId ? eq(activity.entityId, entityId) : undefined,
				actorId ? eq(activity.actorId, actorId) : undefined
			)
		)
		.orderBy(desc(activity.createdAt))
		.limit(limit);
	return rows;
}

/** Staff members who have authored activity rows (for the "By" filter). */
export async function listActivityActors(orgId: string) {
	const rows = await db
		.selectDistinct({ actorId: activity.actorId, name: user.name })
		.from(activity)
		.innerJoin(user, eq(activity.actorId, user.id))
		.where(eq(activity.organizationId, orgId))
		.orderBy(user.name);
	return rows;
}

/** Number of activity rows created within [dayStart, dayEnd) — caller supplies org-tz day bounds. */
export async function countActivity(orgId: string, dayStart: Date, dayEnd: Date) {
	const [{ n }] = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(activity)
		.where(
			and(
				eq(activity.organizationId, orgId),
				gte(activity.createdAt, dayStart),
				lt(activity.createdAt, dayEnd)
			)
		);
	return n;
}

/** Distinct entity types seen in this org's feed (for the filter select). */
export async function listActivityTypes(orgId: string) {
	const rows = await db
		.selectDistinct({ t: activity.entityType })
		.from(activity)
		.where(eq(activity.organizationId, orgId));
	return rows.map((r) => r.t).sort();
}
