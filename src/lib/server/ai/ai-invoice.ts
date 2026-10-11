import { error } from '@sveltejs/kit';
import { aiDecision, aiDecisionAvailable, aiDecisionModel } from './ai.ts';
import { suggestedItemsResponse, toSuggestedItems, type SuggestedItem } from './ai-parse.ts';
import { getJob } from '../services/jobs.ts';
import { listPricebook } from '../services/billing.ts';
import { getSettings } from '../services/settings.ts';

/**
 * Drafts invoice line items for a completed job. The model sees the job summary,
 * description and technician notes plus the org's flat-rate pricebook, and is
 * asked to price work from the catalog where it applies.
 */
export async function suggestInvoiceItems(
	orgId: string,
	jobId: string
): Promise<{ items: SuggestedItem[]; model: string }> {
	if (!aiDecisionAvailable())
		error(
			403,
			'No AI provider configured — set TREDARO_AI_MODEL and an API key or a custom endpoint'
		);

	const j = await getJob(orgId, jobId);
	const [catalog, settings] = await Promise.all([listPricebook(orgId), getSettings(orgId)]);

	const notes = j.events
		.filter((e) => e.event.note)
		.slice(-12)
		.map((e) => `${e.event.kind}: ${e.event.note}`);

	const system = [
		'You draft invoice line items for a field service company.',
		'Reply with ONLY JSON: {"items":[{"name":string,"qty":number,"unitPriceCents":number}]}.',
		'Rules: prefer pricebook names and prices when an item matches the work; qty is whole units',
		'(bill labor in hours when the catalog prices labor hourly); unitPriceCents is an integer in',
		'the smallest currency unit; at most 8 items; no markup explanations; if nothing applies,',
		'return {"items":[]}.'
	].join(' ');

	const user = JSON.stringify({
		job: {
			type: j.jobTypeName,
			summary: j.job.summary,
			description: j.job.description,
			equipment: j.equipmentName,
			technicianNotes: notes
		},
		pricebook: catalog
			.filter((i) => i.active)
			.slice(0, 60)
			.map((i) => ({
				name: i.name,
				category: i.category,
				kind: i.kind,
				priceCents: i.price,
				durationMin: i.durationMin
			})),
		currency: settings.currency
	});

	const parsed = await aiDecision(suggestedItemsResponse, system, user, { maxTokens: 800 });
	return { items: parsed ? toSuggestedItems(parsed) : [], model: aiDecisionModel() };
}
