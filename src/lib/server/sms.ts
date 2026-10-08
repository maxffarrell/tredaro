import {
	TREDARO_DEMO,
	TREDARO_TWILIO_ACCOUNT_SID,
	TREDARO_TWILIO_AUTH_TOKEN,
	TREDARO_TWILIO_BASE_URL,
	TREDARO_TWILIO_FROM
} from '$app/env/private';

export type Sms = { to: string; body: string };

export const smsProvider = (): 'twilio' | null =>
	TREDARO_TWILIO_ACCOUNT_SID && TREDARO_TWILIO_AUTH_TOKEN && TREDARO_TWILIO_FROM ? 'twilio' : null;

const baseUrl = () =>
	(TREDARO_TWILIO_BASE_URL ?? 'https://api.twilio.com/2010-04-01').replace(/\/$/, '');

/** Sends through the org's own Twilio account (BYOK env). Without the vars, logs instead. Never sends in the public demo. */
export async function sendSms({ to, body }: Sms): Promise<string | null> {
	if (TREDARO_DEMO) return null;
	if (!smsProvider()) {
		console.info(`[sms] no provider configured; not sent: "${body.slice(0, 60)}"`);
		return null;
	}
	const res = await fetch(`${baseUrl()}/Accounts/${TREDARO_TWILIO_ACCOUNT_SID}/Messages.json`, {
		method: 'POST',
		headers: {
			authorization: `Basic ${btoa(`${TREDARO_TWILIO_ACCOUNT_SID}:${TREDARO_TWILIO_AUTH_TOKEN}`)}`,
			'content-type': 'application/x-www-form-urlencoded'
		},
		body: new URLSearchParams({ To: to, From: TREDARO_TWILIO_FROM ?? '', Body: body }),
		signal: AbortSignal.timeout(10_000)
	});
	if (!res.ok) throw new Error(`Twilio responded ${res.status}: ${await res.text()}`);
	const json = (await res.json().catch(() => null)) as { sid?: string } | null;
	return json?.sid ?? null;
}
