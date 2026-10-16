import { describe, expect, it, vi } from 'vitest';
vi.mock('$app/env/private', () => ({ BETTER_AUTH_SECRET: 'public-link-test-not-real' }));
import { publicToken, verifyPublicToken } from './public-token.ts';

const id = '00000000-0000-4000-8000-000000000001';
const now = 1_800_000_000_000;

describe('public links', () => {
	for (const purpose of ['estimate', 'invoice', 'report', 'cancel'] as const) {
		it(`authenticates ${purpose} links until their exact expiry`, () => {
			const token = publicToken(purpose, id, now);
			const expiry = Number(token.split('.')[2]) * 1000;
			expect(verifyPublicToken(purpose, token, now)).toBe(id);
			expect(verifyPublicToken(purpose, token, expiry - 1)).toBe(id);
			expect(verifyPublicToken(purpose, token, expiry)).toBeNull();
			expect(verifyPublicToken(purpose, token, now - 1000)).toBeNull();
		});
	}

	it('rejects malformed, legacy, tampered and cross-purpose links', () => {
		const token = publicToken('estimate', id, now);
		for (const invalid of [
			'',
			id,
			`${id}.legacy`,
			` ${token}`,
			`${token}\n`,
			token.replace(id, '------------------------------------'),
			token.replace('000000000001', '000000000002'),
			token.replace('.180', '.190'),
			`${token.slice(0, -1)}!`,
			'x'.repeat(10000)
		])
			expect(verifyPublicToken('estimate', invalid, now)).toBeNull();
		expect(verifyPublicToken('report', token, now)).toBeNull();
		expect(verifyPublicToken('cancel', token, now)).toBeNull();
		expect(() => publicToken('estimate', 'not-a-uuid', now)).toThrow();
	});
});
