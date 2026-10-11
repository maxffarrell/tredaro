/* @license Enterprise */

import { error } from '@sveltejs/kit';
import { getJob } from '../services/jobs.ts';
import { listItems, listJobMaterials } from '../services/inventory.ts';
import { aiAvailable, aiChat, aiModel } from './ai.ts';

export type SuggestedMaterial = {
	inventoryItemId: string;
	name: string;
	qty: number;
	reason: string;
};

/**
 * Suggests materials to pull for a job — "what should the tech load on the
 * truck" — from the job type, summary, and description, restricted to real
 * inventory items so nothing hallucinated can be applied.
 */
export async function suggestMaterials(
	orgId: string,
	jobId: string
): Promise<{ items: SuggestedMaterial[]; model: string }> {
	if (!aiAvailable()) error(403, 'AI requires Tredaro Cloud or an enterprise license');

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

	const text = await aiChat(
		[
			{ role: 'system', content: system },
			{ role: 'user', content: user }
		],
		{ maxTokens: 1200 }
	);
	return {
		items: parseMaterials(text, stock, onJob.map((m) => m.itemName ?? m.material.customName)),
		model: aiModel()
	};
}

export function parseMaterials(
	text: string,
	stock: { id: string; name: string; qtyOnHand: number }[],
	onJob: (string | null)[]
): SuggestedMaterial[] {
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
			? (parsed as Record<string, unknown>).items
			: parsed;
	if (!Array.isArray(raw)) return [];
	const byId = new Map(stock.map((i) => [i.id, i]));
	const onJobNames = new Set(onJob.filter((n): n is string => !!n).map((n) => n.toLowerCase()));
	const out: SuggestedMaterial[] = [];
	const seen = new Set<string>();
	for (const r of raw) {
		if (!r || typeof r !== 'object') continue;
		const rec = r as Record<string, unknown>;
		const item = byId.get(String(rec.inventoryItemId));
		if (!item || seen.has(item.id) || onJobNames.has(item.name.toLowerCase())) continue;
		seen.add(item.id);
		const qty = Math.min(99, Math.max(1, Math.round(Number(rec.qty) || 1)));
		out.push({
			inventoryItemId: item.id,
			name: item.name,
			qty,
			reason: typeof rec.reason === 'string' ? rec.reason.trim().slice(0, 200) : ''
		});
		if (out.length >= 10) break;
	}
	return out;
}

function closingOffsets(text: string, start: number): number[] {
	const out: number[] = [];
	for (let i = text.length - 1; i > start; i--)
		if (text[i] === '}' || text[i] === ']') out.push(i + 1);
	return out;
}
