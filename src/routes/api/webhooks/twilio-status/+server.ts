import { and, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { smsOutbox } from '#lib/server/db/schema.ts';
import { verifyTwilioSignature } from '#lib/server/twilio.ts';
import type { RequestHandler } from './$types';

/**
 * Twilio message-status callback (queued/sent/delivered/undelivered/failed).
 * Configure in the Twilio console alongside the inbound webhook:
 *   HTTP GET {origin}/api/webhooks/twilio-status?org=<orgId>
 * GET is required for the same reason as the inbound webhook: Twilio's POST
 * is form-urlencoded and trips the CSRF guard before hooks run.
 * Correlates `MessageSid` to the `sms_outbox.provider_sid` recorded at send
 * time and stamps the final status (+ ErrorCode detail on failures).
 */
const STATUS_VALUES = new Set(['queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed']);

const handle = async (
	url: URL,
	fields: Map<string, string>,
	signature: string | null,
	signedFields: Map<string, string>
) => {
	verifyTwilioSignature(url, signedFields, signature);
	const orgId = url.searchParams.get('org');
	if (!orgId) return new Response('missing org', { status: 400 });
	const sid = fields.get('MessageSid') ?? fields.get('SmsSid') ?? '';
	const status = (fields.get('MessageStatus') ?? fields.get('SmsStatus') ?? '').toLowerCase();
	if (!sid || !STATUS_VALUES.has(status)) {
		return new Response('unrecognized status payload', { status: 400 });
	}
	const errCode = fields.get('ErrorCode');
	const detail = errCode
		? `Twilio error ${errCode}: ${(fields.get('ErrorMessage') ?? '').slice(0, 400)}`
		: null;
	const updated = await db
		.update(smsOutbox)
		.set({ status, statusDetail: detail })
		.where(and(eq(smsOutbox.organizationId, orgId), eq(smsOutbox.providerSid, sid)))
		.returning({ id: smsOutbox.id });
	if (!updated.length) return new Response('no matching message', { status: 200 });
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
