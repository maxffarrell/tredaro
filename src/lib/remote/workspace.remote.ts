import * as v from 'valibot';
import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { command, query } from '$app/server';
import { requireOrg } from '#lib/server/context.ts';
import { db } from '#lib/server/db/index.ts';
import { customer, member, user, webhook } from '#lib/server/db/schema.ts';
import { dashboard } from '#lib/server/services/dashboard.ts';
import { getReports as reports } from '#lib/server/services/reports.ts';
import { search } from '#lib/server/services/search.ts';
import { loadDemoData } from '#lib/server/services/demo.ts';
import * as settingsSvc from '#lib/server/services/settings.ts';
import {
	activityFilter,
	idSchema,
	officeInput,
	officeUpdate,
	settingsInput,
	webhookInput
} from '#lib/schemas.ts';
import * as eventsSvc from '#lib/server/services/events.ts';
import { assertNotDemo } from '#lib/server/demo-mode.ts';

export const getDashboard = query(async () => dashboard((await requireOrg()).orgId));
export const getReports = query(async () => reports((await requireOrg()).orgId));
export const searchAll = query(v.pipe(v.string(), v.maxLength(100)), async (q) =>
	search((await requireOrg()).orgId, q)
);

export const getSettings = query(async () => settingsSvc.getSettings((await requireOrg()).orgId));
export const updateSettings = command(settingsInput, async (input) => {
	const s = await settingsSvc.updateSettings(await requireOrg('admin'), input);
	void getSettings().refresh();
	return s;
});

export const getOffices = query(async () =>
	settingsSvc.listOffices((await requireOrg()).orgId, true)
);
export const createOffice = command(officeInput, async (input) => {
	const o = await settingsSvc.createOffice(await requireOrg('admin'), input);
	void getOffices().refresh();
	return o;
});
export const updateOffice = command(officeUpdate, async (input) => {
	const o = await settingsSvc.updateOffice(await requireOrg('admin'), input);
	void getOffices().refresh();
	return o;
});

/** Staff of the org (technicians are picked from these). */
export const getStaff = query(async () => {
	const { orgId } = await requireOrg();
	return db
		.select({
			id: member.id,
			userId: user.id,
			name: user.name,
			email: user.email,
			image: user.image,
			role: member.role,
			commissionPct: member.commissionPct,
			laborCostCents: member.laborCostCents,
			staffAlerts: member.staffAlerts,
			createdAt: member.createdAt
		})
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.where(eq(member.organizationId, orgId))
		.orderBy(asc(member.createdAt));
});

const commissionInput = v.object({
	memberId: idSchema,
	commissionPct: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100))
});

/** Sets a technician's commission % used by the reports commission column. */
export const updateCommission = command(commissionInput, async (input) => {
	const { orgId } = await requireOrg();
	const [row] = await db
		.update(member)
		.set({ commissionPct: input.commissionPct })
		.where(and(eq(member.organizationId, orgId), eq(member.id, input.memberId)))
		.returning();
	if (!row) error(404, 'Member not found');
	return row;
});

const laborCostInput = v.object({
	memberId: idSchema,
	laborCostCents: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(50000))
});

/** Sets a technician's loaded hourly cost used by the job-profitability margin. */
export const updateLaborCost = command(laborCostInput, async (input) => {
	const { orgId } = await requireOrg();
	const [row] = await db
		.update(member)
		.set({ laborCostCents: input.laborCostCents })
		.where(and(eq(member.organizationId, orgId), eq(member.id, input.memberId)))
		.returning();
	if (!row) error(404, 'Member not found');
	return row;
});

const staffAlertsInput = v.object({
	memberId: idSchema,
	staffAlerts: v.boolean()
});

/** Turns staff notification emails (bookings, decisions, digest) on/off for a member. */
export const setStaffAlerts = command(staffAlertsInput, async (input) => {
	const { orgId } = await requireOrg('admin');
	const [row] = await db
		.update(member)
		.set({ staffAlerts: input.staffAlerts })
		.where(and(eq(member.organizationId, orgId), eq(member.id, input.memberId)))
		.returning();
	if (!row) error(404, 'Member not found');
	return row;
});

export const getWebhooks = query(async () => {
	const { orgId } = await requireOrg('admin');
	return db
		.select()
		.from(webhook)
		.where(eq(webhook.organizationId, orgId))
		.orderBy(desc(webhook.createdAt));
});
export const createWebhook = command(webhookInput, async (input) => {
	assertNotDemo();
	const { orgId } = await requireOrg('admin');
	const [w] = await db
		.insert(webhook)
		.values({
			organizationId: orgId,
			url: input.url,
			events: input.events,
			secret: `whsec_${randomBytes(24).toString('base64url')}`
		})
		.returning();
	void getWebhooks().refresh();
	return w!;
});
export const toggleWebhook = command(
	v.object({ id: idSchema, enabled: v.boolean() }),
	async ({ id, enabled }) => {
		assertNotDemo();
		const { orgId } = await requireOrg('admin');
		await db
			.update(webhook)
			.set({ enabled })
			.where(and(eq(webhook.organizationId, orgId), eq(webhook.id, id)));
		void getWebhooks().refresh();
	}
);
export const deleteWebhook = command(idSchema, async (id) => {
	const { orgId } = await requireOrg('admin');
	await db.delete(webhook).where(and(eq(webhook.organizationId, orgId), eq(webhook.id, id)));
	void getWebhooks().refresh();
});

export const seedDemo = command(async () => {
	const ctx = await requireOrg('admin');
	const [existing] = await db
		.select({ id: customer.id })
		.from(customer)
		.where(eq(customer.organizationId, ctx.orgId))
		.limit(1);
	if (existing) error(409, 'Demo data can only be loaded into an empty workspace');
	const result = await loadDemoData(ctx);
	void getDashboard().refresh();
	return result;
});

// ---------- activity feed ----------

export const getActivity = query(activityFilter, async (filter) =>
	eventsSvc.listActivity((await requireOrg()).orgId, filter.entityType || undefined)
);
export const getActivityTypes = query(async () =>
	eventsSvc.listActivityTypes((await requireOrg()).orgId)
);
