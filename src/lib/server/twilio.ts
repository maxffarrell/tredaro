import { createHmac, timingSafeEqual } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { TREDARO_TWILIO_AUTH_TOKEN } from '$app/env/private';

/**
 * Verifies `X-Twilio-Signature` (HMAC-SHA1 over the request URL + sorted POST
 * fields, per Twilio's docs). A configured TREDARO_TWILIO_AUTH_TOKEN is
 * required outside local dev: production rejects every request when
 * unconfigured rather than trusting forgeries.
 */
export function verifyTwilioSignature(
	url: URL,
	signedFields: Map<string, string>,
	signature: string | null
) {
	if (!TREDARO_TWILIO_AUTH_TOKEN) {
		// Local dev/stub testing only — a deployed instance without the token
		// must fail closed, not accept unsigned requests.
		if (import.meta.env.DEV) return;
		error(503, 'Twilio webhook is not configured');
	}
	if (!signature) error(403, 'Missing X-Twilio-Signature');
	// GET params already live inside the URL; only POST body fields are appended.
	let payload = url.toString();
	for (const k of [...signedFields.keys()].sort()) payload += k + signedFields.get(k);
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
