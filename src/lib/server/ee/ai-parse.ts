/* @license Enterprise */

import * as v from 'valibot';

export type SuggestedItem = { name: string; qty: number; unitPrice: number };

const MAX_ITEMS = 8;

/**
 * Best-effort JSON extraction from a chat completion. Finds the first `[`/`{`
 * and tries progressively earlier closers, so replies wrapped in prose or a
 * code fence still parse. Returns `null` when nothing parses. Pure — safe to
 * unit test.
 */
export function extractJson(text: string): unknown {
	const start = text.search(/[[{]/);
	if (start < 0) return null;
	for (const end of [text.length, ...closingOffsets(text, start).slice(0, 40)]) {
		try {
			return JSON.parse(text.slice(start, end));
		} catch {
			// keep shrinking
		}
	}
	return null;
}

/** One suggested line-item row as the model is asked to return it. */
const suggestedItemRow = v.object({
	name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
	qty: v.optional(v.number()),
	unitPriceCents: v.optional(v.number()),
	unitPrice: v.optional(v.number())
});

/** Decision response shape for line-item calls: `{"items":[…]}` or a bare array. */
export const suggestedItemsResponse = v.union([
	v.object({ items: v.array(v.unknown()) }),
	v.array(v.unknown())
]);

/**
 * Validates each row of a `suggestedItemsResponse` decision — rows failing the
 * schema are dropped (not the whole list) — then clamps qty to 1–999 and
 * prices to non-negative integer cents, capped at `MAX_ITEMS`.
 */
export function toSuggestedItems(
	parsed: v.InferOutput<typeof suggestedItemsResponse>
): SuggestedItem[] {
	const list = Array.isArray(parsed) ? parsed : parsed.items;
	const items: SuggestedItem[] = [];
	for (const row of list) {
		const r = v.safeParse(suggestedItemRow, row);
		if (!r.success) continue;
		const qty = r.output.qty;
		const cents = r.output.unitPriceCents ?? r.output.unitPrice;
		items.push({
			name: r.output.name,
			qty: Number.isFinite(qty) ? Math.min(999, Math.max(1, Math.round(qty ?? 1))) : 1,
			unitPrice: Number.isFinite(cents) ? Math.max(0, Math.round(cents ?? 0)) : 0
		});
		if (items.length >= MAX_ITEMS) break;
	}
	return items;
}

/**
 * Text-in convenience wrapper kept for callers/tests: `extractJson` +
 * `suggestedItemsResponse` + `toSuggestedItems`. Returns `[]` on any failure.
 */
export function parseSuggestedItems(text: string): SuggestedItem[] {
	const parsed = extractJson(text);
	if (parsed == null) return [];
	const result = v.safeParse(suggestedItemsResponse, parsed);
	return result.success ? toSuggestedItems(result.output) : [];
}

/** Offsets of `]`/`}` characters after `start`, descending, so JSON.parse retries shrink. */
function closingOffsets(text: string, start: number): number[] {
	const out: number[] = [];
	for (let i = text.length - 1; i > start; i--) {
		if (text[i] === ']' || text[i] === '}') out.push(i + 1);
	}
	return out;
}
