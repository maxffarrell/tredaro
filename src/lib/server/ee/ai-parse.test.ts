import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import { extractJson, parseSuggestedItems, suggestedItemsResponse } from './ai-parse.ts';

describe('parseSuggestedItems', () => {
	it('parses a clean {"items":[]} payload', () => {
		const items = parseSuggestedItems(
			'{"items":[{"name":"Capacitor replacement","qty":1,"unitPriceCents":24500},{"name":"Labor","qty":2,"unitPriceCents":9500}]}'
		);
		expect(items).toEqual([
			{ name: 'Capacitor replacement', qty: 1, unitPrice: 24500 },
			{ name: 'Labor', qty: 2, unitPrice: 9500 }
		]);
	});

	it('parses a bare array and tolerates prose fences', () => {
		const items = parseSuggestedItems(
			'Here are the items:\n```json\n[{"name":"Filter","qty":1,"unitPriceCents":3200}]\n```\nHope that helps.'
		);
		expect(items).toEqual([{ name: 'Filter', qty: 1, unitPrice: 3200 }]);
	});

	it('clamps qty and prices, drops nameless rows, caps at 8', () => {
		const raw = {
			items: [
				{ name: '', qty: 1, unitPriceCents: 100 },
				{ name: 'A', qty: 0, unitPriceCents: -50 },
				{ name: 'B', qty: 2.7, unitPriceCents: 99.6 },
				{ name: 'C', qty: 5000, unitPriceCents: 100 },
				...Array.from({ length: 10 }, (_, i) => ({
					name: `X${i}`,
					qty: 1,
					unitPriceCents: 1
				}))
			]
		};
		const items = parseSuggestedItems(JSON.stringify(raw));
		expect(items).toHaveLength(8);
		expect(items[0]).toEqual({ name: 'A', qty: 1, unitPrice: 0 });
		expect(items[1]).toEqual({ name: 'B', qty: 3, unitPrice: 100 });
		expect(items[2].qty).toBe(999);
	});

	it('returns [] on non-JSON or shape mismatch', () => {
		expect(parseSuggestedItems('no json here')).toEqual([]);
		expect(parseSuggestedItems('{"ok":true}')).toEqual([]);
		expect(parseSuggestedItems('{"items":[]}')).toEqual([]);
	});
});

describe('extractJson', () => {
	it('returns null when nothing parses', () => {
		expect(extractJson('no json here')).toBeNull();
		expect(extractJson('')).toBeNull();
	});

	it('extracts a payload wrapped in prose and a code fence', () => {
		expect(extractJson('Sure:\n```json\n{"a":1}\n```\nDone.')).toEqual({ a: 1 });
	});
});

describe('suggestedItemsResponse schema', () => {
	it('accepts wrapped and bare-array shapes, rejects other objects', () => {
		expect(v.safeParse(suggestedItemsResponse, { items: [] }).success).toBe(true);
		expect(v.safeParse(suggestedItemsResponse, []).success).toBe(true);
		expect(v.safeParse(suggestedItemsResponse, { ok: true }).success).toBe(false);
	});
});
