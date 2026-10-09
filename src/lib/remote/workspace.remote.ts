import * as v from 'valibot';
import { randomBytes } from 'node:crypto';
import { and, asc, count, desc, eq, isNull } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { command, query } from '$app/server';
import { requireOrg, requireUser } from '#lib/server/context.ts';
import { refreshQuery } from './_refresh.ts';
import { db } from '#lib/server/db/index.ts';
import {
	customer,
	member,
	notificationLog,
	smsOutbox,
	user,
	webhook
} from '#lib/server/db/schema.ts';
import { dashboard } from '#lib/server/services/dashboard.ts';
import { appOrigin, sendEmail } from '#lib/server/email.ts';
import { smsProvider } from '#lib/server/sms.ts';
import { sendSmsQuiet } from '#lib/server/services/notifications.ts';
import { user as userTable } from '#lib/server/db/schema.ts';
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
import { addDays, localDate, zonedToUtc } from '#lib/tz.ts';

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

/** Staff-facing notification_log entries addressed to the current user's email. */
export const getStaffNotifications = query(
	v.object({ limit: v.optional(v.number()) }),
	async ({ limit }) => {
		const { user: me } = requireUser();
		const { orgId } = await requireOrg();
		return db
			.select()
			.from(notificationLog)
			.where(
				and(eq(notificationLog.organizationId, orgId), eq(notificationLog.recipient, me.email))
			)
			.orderBy(desc(notificationLog.createdAt))
			.limit(limit ?? 50);
	}
);

/** Unread count for the sidebar badge — same scope as getStaffNotifications. */
export const getUnreadNotificationCount = query(async () => {
	const { user: me } = requireUser();
	const { orgId } = await requireOrg();
	const r = await db
		.select({ n: count() })
		.from(notificationLog)
		.where(
			and(
				eq(notificationLog.organizationId, orgId),
				eq(notificationLog.recipient, me.email),
				isNull(notificationLog.readAt)
			)
		);
	return r[0]?.n ?? 0;
});

export const getSmsOutbox = query(async () => {
	const { orgId } = await requireOrg();
	return db
		.select()
		.from(smsOutbox)
		.where(eq(smsOutbox.organizationId, orgId))
		.orderBy(desc(smsOutbox.createdAt))
		.limit(15);
});

export const markNotificationRead = command(v.string(), async (id) => {
	const { user: me } = requireUser();
	const { orgId } = await requireOrg();
	await db
		.update(notificationLog)
		.set({ readAt: new Date() })
		.where(
			and(
				eq(notificationLog.id, id),
				eq(notificationLog.organizationId, orgId),
				eq(notificationLog.recipient, me.email)
			)
		);
	await refreshQuery(getStaffNotifications);
	await refreshQuery(getUnreadNotificationCount);
	return { ok: true };
});

export const markAllNotificationsRead = command(v.object({}), async () => {
	const { user: me } = requireUser();
	const { orgId } = await requireOrg();
	await db
		.update(notificationLog)
		.set({ readAt: new Date() })
		.where(
			and(
				eq(notificationLog.organizationId, orgId),
				eq(notificationLog.recipient, me.email),
				isNull(notificationLog.readAt)
			)
		);
	await refreshQuery(getStaffNotifications);
	await refreshQuery(getUnreadNotificationCount);
	return { ok: true };
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
			skillTags: member.skillTags,
			color: member.color,
			dispatchVisible: member.dispatchVisible,
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

const memberSkillsInput = v.object({
	memberId: idSchema,
	/** Job-type ids the tech is qualified for; empty list = qualified for all. */
	jobTypeIds: v.array(idSchema)
});

/** Sets a technician's qualified job types — dispatch flags assignments outside them. */
export const setMemberSkills = command(memberSkillsInput, async (input) => {
	const { orgId } = await requireOrg('admin');
	const [row] = await db
		.update(member)
		.set({ skillTags: input.jobTypeIds.join(',') })
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

const memberColorInput = v.object({
	memberId: idSchema,
	/** Hex swatch shown on the member's dispatch column ('' clears). */
	color: v.pipe(v.string(), v.trim(), v.regex(/^$|^#[0-9a-fA-F]{6}$/, 'Pick a hex color'))
});

/** Sets a member's dispatch-column accent color. */
export const setMemberColor = command(memberColorInput, async (input) => {
	const { orgId } = await requireOrg('admin');
	const [row] = await db
		.update(member)
		.set({ color: input.color })
		.where(and(eq(member.organizationId, orgId), eq(member.id, input.memberId)))
		.returning();
	if (!row) error(404, 'Member not found');
	return row;
});

const dispatchVisibleInput = v.object({
	memberId: idSchema,
	dispatchVisible: v.boolean()
});

/** Shows/hides a member on the dispatch board and in tech pickers (office staff, owners). */
export const setDispatchVisible = command(dispatchVisibleInput, async (input) => {
	const { orgId } = await requireOrg('admin');
	const [row] = await db
		.update(member)
		.set({ dispatchVisible: input.dispatchVisible })
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

/** POSTs a signed webhook.test event to the endpoint and reports the status. */
export const testWebhook = command(idSchema, async (id) => {
	const { orgId } = await requireOrg('admin');
	return eventsSvc.testWebhookDelivery(orgId, id);
});

export const seedDemo = command(v.object({}), async () => {
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
	eventsSvc.listActivity(
		(await requireOrg()).orgId,
		filter.entityType || undefined,
		undefined,
		filter.limit,
		filter.actorId || undefined
	)
);
export const getActivityTypes = query(async () =>
	eventsSvc.listActivityTypes((await requireOrg()).orgId)
);
export const getActivityActors = query(async () =>
	eventsSvc.listActivityActors((await requireOrg()).orgId)
);
export const getActivityTodayCount = query(async () => {
	const ctx = await requireOrg();
	const tz = (await settingsSvc.getSettings(ctx.orgId)).timezone;
	const today = localDate(new Date(), tz);
	return eventsSvc.countActivity(
		ctx.orgId,
		zonedToUtc(`${today}T00:00`, tz),
		zonedToUtc(`${addDays(today, 1)}T00:00`, tz)
	);
});

export const getActivityWeekCount = query(async () => {
	const ctx = await requireOrg();
	const tz = (await settingsSvc.getSettings(ctx.orgId)).timezone;
	const today = localDate(new Date(), tz);
	return eventsSvc.countActivity(
		ctx.orgId,
		zonedToUtc(`${addDays(today, -6)}T00:00`, tz),
		zonedToUtc(`${addDays(today, 1)}T00:00`, tz)
	);
});

export const sendTestEmail = command(v.object({}), async () => {
	const ctx = await requireOrg();
	const [u] = await db
		.select({ email: userTable.email })
		.from(userTable)
		.where(eq(userTable.id, ctx.userId));
	if (!u?.email) error(400, 'Your account has no email');
	await sendEmail({
		to: u.email,
		subject: 'Tredaro test email',
		text: 'If you can read this, outbound email works for your workspace. ' + appOrigin(),
		html: `<p>If you can read this, outbound email works for your workspace.</p><p>${appOrigin()}</p>`
	});
});

export const sendTestSms = command(v.object({ to: v.string() }), async (input) => {
	if (!smsProvider()) error(400, 'No SMS provider configured');
	const ctx = await requireOrg();
	await sendSmsQuiet(ctx.orgId, { to: input.to, body: 'Tredaro test text — SMS is working.' });
});
