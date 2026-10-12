import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { getJob } from '../services/jobs.ts';
import { listItems, listJobMaterials } from '../services/inventory.ts';
import { aiDecision, aiDecisionAvailable, aiDecisionModel } from './ai.ts';

export type SuggestedMaterial = {
	inventoryItemId: string;
	name: string;
	qty: number;
	reason: string;
};

const materialRow = v.object({
	inventoryItemId: v.string(),
	qty: v.optional(v.number()),
	reason: v.fallback(
		v.pipe(
			v.string(),
			v.transform((s) => s.trim().slice(0, 200))
		),
		''
	)
});

const materialsResponse = v.union([
	v.object({ items: v.array(v.unknown()) }),
	v.array(v.unknown())
]);

/**
 * Suggests materials to pull for a job — "what should the tech load on the
 * truck" — from the job type, summary, and description, restricted to real
 * inventory items so nothing hallucinated can be applied.
 */
export async function suggestMaterials(
	orgId: string,
	jobId: string
): Promise<{ items: SuggestedMaterial[]; model: string }> {
	if (!aiDecisionAvailable())
		error(
			403,
			'No AI provider configured — set TREDARO_AI_MODEL and an API key or a custom endpoint'
		);

	const [j, inventory, onJob] = await Promise.all([
		getJob(orgId, jobId),
		listItems(orgId),
		listJobMaterials(orgId, jobId)
	]);
	const stock = inventory.map((r) => r.item).filter((i) => i.qtyOnHand > 0);
	if (!stock.length) error(400, 'No in-stock inventory items to suggest from');

	const system = [
		'You pick which warehouse items a field tech should load for a job.',
		'Reply with ONLY JSON: {"items":[{"inventoryItemId":string,"qty":number,"reason":string}]}.',
		'Rules: choose ONLY from the provided inventory ids; qty is a small integer;',
		'reason is a few words; skip items already on the job; at most 10 items;',
		'if nothing fits, return {"items":[]}.'
	].join(' ');

	const user = JSON.stringify({
		job: {
			type: j.jobTypeName,
			summary: j.job.summary,
			description: j.job.description?.slice(0, 1000)
		},
		alreadyOnJob: onJob.map((m) => m.itemName ?? m.material.customName),
		inventory: stock.slice(0, 80).map((i) => ({
			id: i.id,
			name: i.name,
			onHand: i.qtyOnHand,
			category: i.category
		}))
	});

	const parsed = await aiDecision(materialsResponse, system, user, { maxTokens: 1200 });
	const rows = parsed == null ? [] : Array.isArray(parsed) ? parsed : parsed.items;

	const byId = new Map(stock.map((i) => [i.id, i]));
	const onJobNames = new Set(
		onJob
			.map((m) => m.itemName ?? m.material.customName)
			.filter((n): n is string => !!n)
			.map((n) => n.toLowerCase())
	);
	const out: SuggestedMaterial[] = [];
	const seen = new Set<string>();
	for (const row of rows) {
		const r = v.safeParse(materialRow, row);
		if (!r.success) continue;
		const item = byId.get(r.output.inventoryItemId);
		if (!item || seen.has(item.id) || onJobNames.has(item.name.toLowerCase())) continue;
		seen.add(item.id);
		const qty = r.output.qty;
		out.push({
			inventoryItemId: item.id,
			name: item.name,
			qty: Math.min(99, Math.max(1, Math.round(Number.isFinite(qty) ? (qty ?? 1) : 1))),
			reason: r.output.reason
		});
		if (out.length >= 10) break;
	}
	return { items: out, model: aiDecisionModel() };
}
