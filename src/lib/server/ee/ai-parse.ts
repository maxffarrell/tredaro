/* @license Enterprise */

export type SuggestedItem = { name: string; qty: number; unitPrice: number };

const MAX_ITEMS = 8;

/**
 * Best-effort extraction of invoice line items from a chat completion. Accepts
 * `{"items":[...]}` or a bare array, possibly wrapped in prose or a code fence.
 * Clamps qty to 1–999 and prices to non-negative integer cents; drops malformed
 * rows; caps the list at `MAX_ITEMS`. Pure — safe to unit test.
 */
export function parseSuggestedItems(text: string): SuggestedItem[] {
	const start = text.search(/[[{]/);
	if (start < 0) return [];
	let parsed: unknown = null;
	// Try the largest candidate first (whole tail), shrinking to earlier closers.
	for (const end of [text.length, ...closingOffsets(text, start).slice(0, 40)]) {
		try {
			parsed = JSON.parse(text.slice(start, end));
			break;
		} catch {
			// keep shrinking
		}
	}
	if (parsed == null) return [];
	const list = Array.isArray(parsed)
		? parsed
		: Array.isArray((parsed as { items?: unknown }).items)
			? (parsed as { items: unknown[] }).items
			: [];
	const items: SuggestedItem[] = [];
	for (const row of list) {
		if (!row || typeof row !== 'object') continue;
		const r = row as Record<string, unknown>;
		const name = typeof r.name === 'string' ? r.name.trim().slice(0, 200) : '';
		if (!name) continue;
		const qty = Number(r.qty);
		const cents = Number(r.unitPriceCents ?? r.unitPrice);
		items.push({
			name,
			qty: Number.isFinite(qty) ? Math.min(999, Math.max(1, Math.round(qty))) : 1,
			unitPrice: Number.isFinite(cents) ? Math.max(0, Math.round(cents)) : 0
		});
		if (items.length >= MAX_ITEMS) break;
	}
	return items;
}

/** Offsets of `]`/`}` characters after `start`, descending, so JSON.parse retries shrink. */
function closingOffsets(text: string, start: number): number[] {
	const out: number[] = [];
	for (let i = text.length - 1; i > start; i--) {
		if (text[i] === ']' || text[i] === '}') out.push(i + 1);
	}
	return out;
}
