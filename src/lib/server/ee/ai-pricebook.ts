/* @license Enterprise */

import { error } from '@sveltejs/kit';
import { aiAvailable, aiChat, aiModel } from './ai.ts';
import { getSettings } from '../services/settings.ts';
import { listPricebook } from '../services/billing.ts';

export type DraftedItem = {
	name: string;
	kind: 'service' | 'material';
	category: string;
	price: number;
	durationMin: number | null;
};

/**
 * Drafts pricebook items from free text (a description of services offered, a
 * pasted vendor price list, a competitor sheet). The model also sees existing
 * item names so it fills gaps instead of duplicating the catalog.
 */
export async function draftPricebookItems(
	orgId: string,
	prompt: string
): Promise<{ items: DraftedItem[]; model: string }> {
	if (!aiAvailable()) error(403, 'AI requires Tredaro Cloud or an enterprise license');

	const [catalog, settings] = await Promise.all([listPricebook(orgId), getSettings(orgId)]);

	const system = [
		'You draft flat-rate pricebook entries for a field service company.',
		'Reply with ONLY JSON: {"items":[{"name":string,"kind":"service"|"material",',
		'"category":string,"priceCents":number,"durationMin":number|null}]}.',
		'Rules: priceCents is an integer in the smallest currency unit (use market-typical',
		'prices when the input gives none); durationMin only for services, whole minutes;',
		'at most 20 items; skip anything already in the existing catalog; if nothing fits,',
		'return {"items":[]}.'
	].join(' ');

	const user = JSON.stringify({
		request: prompt.slice(0, 4000),
		existingItems: catalog.map((i) => i.name).slice(0, 80),
		currency: settings.currency
	});

	const text = await aiChat(
		[
			{ role: 'system', content: system },
			{ role: 'user', content: user }
		],
		{ maxTokens: 2000 }
	);
	return { items: parseDraftedItems(text), model: aiModel() };
}

/** Best-effort `{"items":[…]}` extraction with the same shrink-and-retry as ai-parse. */
export function parseDraftedItems(text: string): DraftedItem[] {
	const start = text.search(/[[{]/);
	if (start < 0) return [];
	let parsed: unknown = null;
	for (const end of [text.length, ...closingOffsets(text, start).slice(0, 40)]) {
		try {
			parsed = JSON.parse(text.slice(start, end));
			break;
		} catch {
			// keep shrinking
		}
	}
	const list = Array.isArray(parsed)
		? parsed
		: Array.isArray((parsed as { items?: unknown } | null)?.items)
			? (parsed as { items: unknown[] }).items
			: [];
	const out: DraftedItem[] = [];
	for (const row of list) {
		if (!row || typeof row !== 'object') continue;
		const r = row as Record<string, unknown>;
		const name = typeof r.name === 'string' ? r.name.trim().slice(0, 200) : '';
		if (!name) continue;
		const price = Number(r.priceCents ?? r.price);
		const dur = Number(r.durationMin);
		out.push({
			name,
			kind: r.kind === 'material' ? 'material' : 'service',
			category: typeof r.category === 'string' ? r.category.slice(0, 60) : '',
			price: Number.isFinite(price) ? Math.max(0, Math.round(price)) : 0,
			durationMin: Number.isFinite(dur) && dur > 0 ? Math.round(dur) : null
		});
		if (out.length >= 20) break;
	}
	return out;
}

function closingOffsets(text: string, start: number): number[] {
	const out: number[] = [];
	for (let i = text.length - 1; i > start; i--)
		if (text[i] === '}' || text[i] === ']') out.push(i + 1);
	return out;
}
