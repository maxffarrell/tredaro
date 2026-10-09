import { timingSafeEqual } from 'node:crypto';
import { error, json } from '@sveltejs/kit';
import { CRON_SECRET } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { organization } from '#lib/server/db/schema.ts';
import { runBilling } from '#lib/server/services/billing.ts';
import { runReminders, runWeeklyDigest } from '#lib/server/services/notifications.ts';
import { runSchedules } from '#lib/server/services/maintenance.ts';
import { runRestock } from '#lib/server/services/inventory.ts';
import { purgeExpiredDemos } from '#lib/server/demo-mode.ts';
import type { RequestHandler } from './$types';

const authorized = (header: string | null) => {
	if (!CRON_SECRET || !header) return false;
	const a = Buffer.from(header);
	const b = Buffer.from(`Bearer ${CRON_SECRET}`);
	return a.length === b.length && timingSafeEqual(a, b);
};

/** Daily job: posts due membership charges, sends reminders/digests, and deletes expired demo orgs. */
export const GET: RequestHandler = async ({ request }) => {
	if (!authorized(request.headers.get('authorization'))) error(401, 'Unauthorized');
	const orgs = await db.select({ id: organization.id }).from(organization);
	let failed = 0;
	for (const o of orgs) {
		try {
			await runBilling(o.id);
			await runSchedules(o.id);
			await runReminders(o.id);
			await runRestock(o.id);
			await runWeeklyDigest(o.id);
		} catch (err) {
			failed++;
			console.error(`daily cron failed for ${o.id}`, err);
		}
	}
	await purgeExpiredDemos();
	return json({ workspaces: orgs.length, failed });
};

export const POST = GET;
