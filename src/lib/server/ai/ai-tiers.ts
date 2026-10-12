import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { aiDecision, aiDecisionAvailable, aiDecisionModel } from './ai.ts';

export type TierGroup = { name: string; items: number[] };

const tierGroupRow = v.object({
	name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(40)),
	items: v.array(v.number())
});

const tiersResponse = v.union([v.object({ groups: v.array(v.unknown()) }), v.array(v.unknown())]);

/**
 * Groups an estimate's line items into named option tiers (the good/better/
 * best pattern). The model sees item index + name + price and returns tier
 * names with the indexes that belong to each; unassigned items stay base.
 */
export async function suggestTiers(
	items: { name: string; unitPrice: number; qty: number }[]
): Promise<{ groups: TierGroup[]; model: string }> {
	if (!aiDecisionAvailable())
		error(
			403,
			'No AI provider configured — set TREDARO_AI_MODEL and an API key or a custom endpoint'
		);
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

	const parsed = await aiDecision(tiersResponse, system, user, { maxTokens: 800 });
	const rows = parsed == null ? [] : Array.isArray(parsed) ? parsed : parsed.groups;

	const used = new Set<number>();
	const out: TierGroup[] = [];
	for (const row of rows.slice(0, 4)) {
		const r = v.safeParse(tierGroupRow, row);
		if (!r.success) continue;
		const idx: number[] = [];
		for (const n of r.output.items) {
			const i = Math.trunc(n);
			if (Number.isInteger(i) && i >= 0 && i < items.length && !used.has(i)) {
				used.add(i);
				idx.push(i);
			}
		}
		if (r.output.name && idx.length) out.push({ name: r.output.name, items: idx });
	}
	return { groups: out, model: aiDecisionModel() };
}
