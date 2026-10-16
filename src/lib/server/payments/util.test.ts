import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fromDecimal, hmacValid, customerRef, parseCustomerRef, toDecimal } from './util.ts';

const customer = '0c63a834-455b-4da0-99b1-1ca0b8ff28d0';

describe('money', () => {
	it('round-trips minor units', () => {
		expect(toDecimal(145000)).toBe('1450.00');
		expect(toDecimal(5)).toBe('0.05');
		expect(fromDecimal('1450.00')).toBe(145000);
		expect(fromDecimal('12.5')).toBe(1250);
		expect(fromDecimal('7')).toBe(700);
	});
	it('rejects malformed amounts', () => {
		for (const v of ['', '-1.00', '1.234', 'abc', null, undefined]) expect(fromDecimal(v)).toBe(0);
	});
});

describe('customer refs', () => {
	it('round-trips', () => {
		expect(parseCustomerRef(customerRef('org_AbC-12', customer))).toEqual({
			orgId: 'org_AbC-12',
			customerId: customer
		});
	});
	it('rejects anything else', () => {
		for (const v of [
			undefined,
			42,
			'org',
			`org:${customer}:x`,
			`a b:${customer}`,
			'org:not-a-uuid'
		])
			expect(parseCustomerRef(v)).toBeNull();
	});
});

describe('hmacValid', () => {
	const body = '{"type":"payment.updated"}';
	it('checks hex signatures', () => {
		const sig = createHmac('sha256', 'whsec_test_not_real').update(body).digest('hex');
		expect(hmacValid(body, sig, ['old_test_not_real', 'whsec_test_not_real'], 'hex')).toBe(true);
		expect(hmacValid(body + ' ', sig, ['whsec_test_not_real'], 'hex')).toBe(false);
		expect(hmacValid(body, sig, ['wrong'], 'hex')).toBe(false);
		expect(hmacValid(body, null, ['whsec_test_not_real'], 'hex')).toBe(false);
		expect(hmacValid(body, 'zz', ['whsec_test_not_real'], 'hex')).toBe(false);
	});
	it('checks base64 signatures over a prefix + body', () => {
		const url = 'https://pm.example.com/api/payments/stripe/webhook';
		const sig = createHmac('sha256', 'test_not_real_signing_key')
			.update(url + body)
			.digest('base64');
		expect(hmacValid(body, sig, ['test_not_real_signing_key'], 'base64', url)).toBe(true);
		expect(
			hmacValid(body, sig, ['test_not_real_signing_key'], 'base64', 'https://evil.example.com/x')
		).toBe(false);
	});
});
