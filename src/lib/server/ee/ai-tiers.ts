/* @license Enterprise */

import { error } from '@sveltejs/kit';
import { aiAvailable, aiChat, aiModel } from './ai.ts';

export type TierGroup = { name: string; items: number[] };

/**
 * Groups an estimate's line items into named option tiers (the good/better/
 * best pattern). The model sees item index + name + price and returns tier
 * names with the indexes that belong to each; unassigned items stay base.
 */
export async function suggestTiers(
	items: { name: string; unitPrice: number; qty: number }[]
): Promise<{ groups: TierGroup[]; model: string }> {
	if (!aiAvailable()) error(403, 'AI requires Tredaro Cloud or an enterprise license');
	if (!items.length) error(400, 'Add line items before tiering');

	const system = [
		'You organize a field-service estimate into named option tiers for the customer.',
		'Reply with ONLY JSON: {"groups":[{"name":string,"items":[number]}]}.',
		'Rules: 2 or 3 tiers ordered cheapest→most complete ("Essential","Plus","Premium");',
		'"items" holds 0-based indexes from the provided line items; every index appears',
		'at most once; a group must have at least one item; leave core lines out of all',
		'groups only when they genuinely apply to every tier.'
	].join(' ');

	const user = JSON.stringify({
		items: items.slice(0, 30).map((i, n) => ({
			index: n,
			name: i.name.slice(0, 200),
			qty: i.qty,
			unitPrice: i.unitPrice
		}))
	});

	const text = await aiChat(
		[
			{ role: 'system', content: system },
			{ role: 'user', content: user }
		],
		{ maxTokens: 800 }
	);
	return { groups: parseTiers(text, items.length), model: aiModel() };
}

export function parseTiers(text: string, itemCount: number): TierGroup[] {
	const start = text.search(/[[{]/);
	if (start < 0) return [];
	let parsed: unknown = null;
	for (const end of [text.length, ...closingOffsets(text, start).slice(0, 40)]) {
		try {
			const p = JSON.parse(text.slice(start, end));
			if (p && typeof p === 'object') {
				parsed = p;
				break;
			}
		} catch {
			/* shrink and retry */
		}
	}
	const raw =
		parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>).groups
			: parsed;
	if (!Array.isArray(raw)) return [];
	const used = new Set<number>();
	const out: TierGroup[] = [];
	for (const g of raw.slice(0, 4)) {
		if (!g || typeof g !== 'object') continue;
		const rec = g as Record<string, unknown>;
		const name = typeof rec.name === 'string' ? rec.name.trim().slice(0, 40) : '';
		const idx = Array.isArray(rec.items) ? rec.items : [];
		const items: number[] = [];
		for (const n of idx) {
			const i = Math.trunc(Number(n));
			if (Number.isInteger(i) && i >= 0 && i < itemCount && !used.has(i)) {
				used.add(i);
				items.push(i);
			}
		}
		if (name && items.length) out.push({ name, items });
	}
	return out;
}

function closingOffsets(text: string, start: number): number[] {
	const out: number[] = [];
	for (let i = text.length - 1; i > start; i--)
		if (text[i] === '}' || text[i] === ']') out.push(i + 1);
	return out;
}
