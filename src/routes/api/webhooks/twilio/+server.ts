import { and, asc, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { customer, job, member, notificationLog, user } from '#lib/server/db/schema.ts';
import { verifyTwilioSignature } from '#lib/server/twilio.ts';
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

const handle = async (
	url: URL,
	fields: Map<string, string>,
	signature: string | null,
	signedFields: Map<string, string>
) => {
	verifyTwilioSignature(url, signedFields, signature);
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
	// Semantic replies: 'c'/'confirm'/'yes' confirms the next upcoming visit
	// (a 'confirmed' job event, same as the portal button); a bare 1-5 rates
	// the most recent completed unrated visit.
	let actionTaken = false;
	if (['c', 'confirm', 'confirmed', 'yes'].includes(key)) {
		const [next] = await db
			.select({ id: job.id, startsAt: job.startsAt })
			.from(job)
			.where(
				and(
					eq(job.organizationId, orgId),
					eq(job.customerId, cust.id),
					inArray(job.status, ['scheduled', 'dispatched']),
					isNull(job.cancelledAt),
					gte(job.startsAt, new Date())
				)
			)
			.orderBy(asc(job.startsAt))
			.limit(1);
		if (next) {
			const { confirmVisit } = await import('#lib/server/services/portal.ts');
			try {
				await confirmVisit(orgId, cust.id, next.id);
				const { ackConfirmSms } = await import('#lib/server/services/notifications.ts');
				await ackConfirmSms(orgId, cust.phone ?? from, next.startsAt);
				actionTaken = true;
			} catch {
				// already confirmed — fall through to the generic log
			}
		}
	}
	const ratingMatch = /^([1-5])(\s*stars?)?\b/.exec(key);
	if (!actionTaken && ratingMatch) {
		const [latest] = await db
			.select({ id: job.id })
			.from(job)
			.where(
				and(
					eq(job.organizationId, orgId),
					eq(job.customerId, cust.id),
					eq(job.status, 'done'),
					isNull(job.rating),
					isNull(job.cancelledAt)
				)
			)
			.orderBy(desc(sql`coalesce(${job.endsAt}, ${job.updatedAt})`))
			.limit(1);
		if (latest) {
			const { rateVisit } = await import('#lib/server/services/portal.ts');
			try {
				await rateVisit(orgId, cust.id, latest.id, Number(ratingMatch[1]), 'via SMS reply');
				const { ackRatingSms } = await import('#lib/server/services/notifications.ts');
				await ackRatingSms(orgId, cust.phone ?? from, Number(ratingMatch[1]));
				actionTaken = true;
			} catch {
				// already rated — fall through
			}
		}
	}
	// Every inbound text lands in the communications history on the customer page.
	await db.insert(notificationLog).values({
		organizationId: orgId,
		kind: 'inbound_sms',
		entityId: `${cust.id}:${Date.now()}`,
		recipient: `${cust.phone ?? from}:${body.slice(0, 140)}`
	});
	// Real replies (not STOP/START) also ping the staff inbox so replies aren't missed.
	const isKeyword = [
		'stop',
		'stopall',
		'unsubscribe',
		'cancel',
		'end',
		'quit',
		'start',
		'unstop',
		'yes'
	].includes(key);
	if (!isKeyword && body && !actionTaken) {
		const staff = await db
			.select({ email: user.email })
			.from(member)
			.innerJoin(user, eq(user.id, member.userId))
			.where(and(eq(member.organizationId, orgId), eq(member.staffAlerts, true)));
		const { ackInboundSms } = await import('#lib/server/services/notifications.ts');
		await ackInboundSms(orgId, cust.id, cust.phone ?? from);
		if (staff.length)
			await db.insert(notificationLog).values(
				staff
					.filter((m) => m.email)
					.map((m) => ({
						organizationId: orgId,
						kind: 'inbound_sms_staff',
						entityId: `${cust.id}:${Date.now()}`,
						recipient: m.email!
					}))
			);
	}
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
