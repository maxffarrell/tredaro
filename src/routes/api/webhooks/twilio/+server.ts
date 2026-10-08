import { and, eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { customer, notificationLog } from '#lib/server/db/schema.ts';
import type { RequestHandler } from './$types';

/**
 * Twilio inbound-SMS webhook. Configure in the Twilio console:
 *   POST {origin}/api/webhooks/twilio?org=<orgId>
 * STOP/START toggle the customer's sms opt-out; any other reply is logged to
 * the customer's communications history as an inbound text.
 */
const digits = (s: string) => s.replace(/\D/g, '');

export const POST: RequestHandler = async ({ url, request }) => {
	const orgId = url.searchParams.get('org');
	if (!orgId) return new Response('missing org', { status: 400 });
	const form = await request.formData();
	const from = String(form.get('From') ?? '');
	const body = String(form.get('Body') ?? '').trim();
	const last10 = digits(from).slice(-10);
	if (last10.length < 7) return new Response('unrecognized sender', { status: 400 });

	const [cust] = await db
		.select({ id: customer.id, smsOptOut: customer.smsOptOut })
		.from(customer)
		.where(
			and(
				eq(customer.organizationId, orgId),
				sql`regexp_replace(${customer.phone}, '\\D', '', 'g') like ${`%${last10}`}`
			)
		)
		.limit(1);
	if (!cust) return new Response('no matching customer', { status: 200 });

	const key = body.toLowerCase();
	if (['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit'].includes(key)) {
		if (!cust.smsOptOut)
			await db.update(customer).set({ smsOptOut: true }).where(eq(customer.id, cust.id));
	} else if (['start', 'unstop', 'yes'].includes(key)) {
		if (cust.smsOptOut)
			await db.update(customer).set({ smsOptOut: false }).where(eq(customer.id, cust.id));
	}
	// Every inbound text lands in the communications history on the customer page.
	await db.insert(notificationLog).values({
		organizationId: orgId,
		kind: 'inbound_sms',
		entityId: `${cust.id}:${Date.now()}`,
		recipient: `${from}:${body.slice(0, 140)}`
	});
	return new Response('<Response/>', {
		headers: { 'content-type': 'text/xml' }
	});
};
