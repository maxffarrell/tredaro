import { createHmac, timingSafeEqual } from 'node:crypto';
import { BETTER_AUTH_SECRET } from '$app/env/private';

type Purpose = 'estimate' | 'invoice' | 'report' | 'cancel';
const LIFETIME_SECONDS: Record<Purpose, number> = {
	estimate: 30 * 86400,
	invoice: 30 * 86400,
	report: 90 * 86400,
	cancel: 30 * 86400
};
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const FORMAT = new RegExp(`^v1\\.(${UUID})\\.([1-9][0-9]{9})\\.([A-Za-z0-9_-]{43})$`);

function signature(purpose: Purpose, payload: string) {
	return createHmac('sha256', BETTER_AUTH_SECRET)
		.update(`public:${purpose}:${payload}`)
		.digest('base64url');
}

export function publicToken(purpose: Purpose, id: string, now = Date.now()) {
	if (id.length !== 36 || !new RegExp(`^${UUID}$`).test(id))
		throw new Error('Invalid public link identifier');
	const expires = Math.floor(now / 1000) + LIFETIME_SECONDS[purpose];
	const payload = `v1.${id}.${expires}`;
	return `${payload}.${signature(purpose, payload)}`;
}

export function verifyPublicToken(purpose: Purpose, token: string, now = Date.now()) {
	const match = FORMAT.exec(token);
	if (!match || match[0] !== token) return null;
	const [, id, expires, supplied] = match;
	const remaining = Number(expires) - Math.floor(now / 1000);
	if (remaining <= 0 || remaining > LIFETIME_SECONDS[purpose]) return null;
	const payload = `v1.${id}.${expires}`;
	const expected = Buffer.from(signature(purpose, payload));
	return timingSafeEqual(expected, Buffer.from(supplied!)) ? id! : null;
}
