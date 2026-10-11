import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { aiDecision, aiDecisionAvailable, aiDecisionModel } from './ai.ts';
import { getSettings } from '../services/settings.ts';
import { listPricebook } from '../services/billing.ts';

export type DraftedItem = {
	name: string;
	kind: 'service' | 'material';
	category: string;
	price: number;
	durationMin: number | null;
};

const draftedRow = v.object({
	name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
	kind: v.fallback(v.picklist(['service', 'material']), 'service'),
	category: v.fallback(
		v.pipe(
			v.string(),
			v.transform((s) => s.slice(0, 60))
		),
		''
	),
	priceCents: v.optional(v.number()),
	price: v.optional(v.number()),
	durationMin: v.optional(v.nullable(v.number()))
});

const pricebookResponse = v.union([
	v.object({ items: v.array(v.unknown()) }),
	v.array(v.unknown())
]);

/**
 * Drafts pricebook items from free text (a description of services offered, a
 * pasted vendor price list, a competitor sheet). The model also sees existing
 * item names so it fills gaps instead of duplicating the catalog.
 */
export async function draftPricebookItems(
	orgId: string,
	prompt: string
): Promise<{ items: DraftedItem[]; model: string }> {
	if (!aiDecisionAvailable())
		error(
			403,
			'No AI provider configured — set TREDARO_AI_MODEL and an API key or a custom endpoint'
		);

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

	const parsed = await aiDecision(pricebookResponse, system, user, { maxTokens: 2000 });
	const rows = parsed == null ? [] : Array.isArray(parsed) ? parsed : parsed.items;

	const out: DraftedItem[] = [];
	for (const row of rows) {
		const r = v.safeParse(draftedRow, row);
		if (!r.success) continue;
		const price = r.output.priceCents ?? r.output.price;
		const dur = r.output.durationMin;
		out.push({
			name: r.output.name,
			kind: r.output.kind,
			category: r.output.category,
			price: Number.isFinite(price) ? Math.max(0, Math.round(price ?? 0)) : 0,
			durationMin: Number.isFinite(dur) && (dur ?? 0) > 0 ? Math.round(dur ?? 0) : null
		});
		if (out.length >= 20) break;
	}
	return { items: out, model: aiDecisionModel() };
}
