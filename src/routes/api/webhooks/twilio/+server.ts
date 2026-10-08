import { createHmac, timingSafeEqual } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { and, eq, sql } from 'drizzle-orm';
import { TREDARO_TWILIO_AUTH_TOKEN } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { customer, notificationLog } from '#lib/server/db/schema.ts';
import type { RequestHandler } from './$types';

/**
 * Twilio inbound-SMS webhook. Configure in the Twilio console:
 *   HTTP GET {origin}/api/webhooks/twilio?org=<orgId>
 * GET is required: Twilio's POST is application/x-www-form-urlencoded, which
 * SvelteKit's CSRF guard rejects before hooks run (Twilio sends no Origin).
 * STOP/START toggle the customer's sms opt-out; any other reply is logged to
 * the customer's communications history as an inbound text.
 *
 * Requests are verified against `X-Twilio-Signature` (HMAC-SHA1 over the
 * request URL + sorted POST fields, per Twilio's docs). A configured
 * TREDARO_TWILIO_AUTH_TOKEN is required outside local dev: production
 * rejects every request when unconfigured rather than trusting forgeries.
 */
const digits = (s: string) => s.replace(/\D/g, '');

function verifySignature(url: URL, fields: Map<string, string>, signature: string | null) {
	if (!TREDARO_TWILIO_AUTH_TOKEN) {
		// Local dev/stub testing only — a deployed instance without the token
		// must fail closed, not accept unsigned requests.
		if (import.meta.env.DEV) return;
		error(503, 'Twilio webhook is not configured');
	}
	if (!signature) error(403, 'Missing X-Twilio-Signature');
	// GET params already live inside the URL; only POST body fields are appended.
	let payload = url.toString();
	for (const k of [...fields.keys()].sort()) payload += k + fields.get(k);
	const expected = createHmac('sha1', TREDARO_TWILIO_AUTH_TOKEN).update(payload).digest();
	let given: Buffer;
	try {
		given = Buffer.from(signature, 'base64');
	} catch {
		error(403, 'Invalid X-Twilio-Signature');
	}
	if (given!.length !== expected.length || !timingSafeEqual(given!, expected)) {
		error(403, 'Invalid X-Twilio-Signature');
	}
}

const handle = async (
	url: URL,
	fields: Map<string, string>,
	signature: string | null,
	signedFields: Map<string, string>
) => {
	verifySignature(url, signedFields, signature);
	const orgId = url.searchParams.get('org');
	if (!orgId) return new Response('missing org', { status: 400 });
	const from = fields.get('From') ?? fields.get('from') ?? '';
	const body = (fields.get('Body') ?? fields.get('body') ?? '').trim();
	const last10 = digits(from).slice(-10);
	if (last10.length < 7) return new Response('unrecognized sender', { status: 400 });

	const [cust] = await db
		.select({ id: customer.id, smsOptOut: customer.smsOptOut, phone: customer.phone })
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
		recipient: `${cust.phone ?? from}:${body.slice(0, 140)}`
	});
	return new Response('<Response/>', {
		headers: { 'content-type': 'text/xml' }
	});
};

export const GET: RequestHandler = ({ url, request }) =>
	handle(
		url,
		new Map([...url.searchParams.entries()].map(([k, v]) => [k, v])),
		request.headers.get('x-twilio-signature'),
		new Map() // GET params are already inside the signed URL
	);

// Kept for correctness when the caller supplies an Origin header; Twilio's
// real posts are CSRF-blocked, so the GET URL above is the supported path.
export const POST: RequestHandler = async ({ url, request }) => {
	const form = new Map((await request.formData()).entries().map(([k, v]) => [k, String(v)]));
	return handle(url, form, request.headers.get('x-twilio-signature'), form);
};
