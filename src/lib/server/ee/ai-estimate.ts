/* @license Enterprise */

import { error } from '@sveltejs/kit';
import { aiDecision, aiDecisionAvailable, aiDecisionModel } from './ai.ts';
import { suggestedItemsResponse, toSuggestedItems, type SuggestedItem } from './ai-parse.ts';
import { listPricebook } from '../services/billing.ts';
import { getSettings } from '../services/settings.ts';
import { db } from '#lib/server/db/index.ts';
import { customer, jobType } from '#lib/server/db/schema.ts';
import { and, eq } from 'drizzle-orm';

/**
 * Drafts estimate line items before a job exists. The model sees the customer,
 * chosen job type and the estimator's notes plus the org's flat-rate pricebook.
 */
export async function suggestEstimateItems(
	orgId: string,
	args: { customerId: string; jobTypeId: string | null; notes: string }
): Promise<{ items: SuggestedItem[]; model: string }> {
	if (!aiDecisionAvailable()) error(403, 'AI requires Tredaro Cloud or an enterprise license');

	const [[c], [jt], catalog, settings] = await Promise.all([
		db
			.select({ name: customer.name, type: customer.type })
			.from(customer)
			.where(and(eq(customer.organizationId, orgId), eq(customer.id, args.customerId))),
		args.jobTypeId
			? db
					.select({ name: jobType.name })
					.from(jobType)
					.where(and(eq(jobType.organizationId, orgId), eq(jobType.id, args.jobTypeId)))
			: Promise.resolve([undefined]),
		listPricebook(orgId),
		getSettings(orgId)
	]);
	if (!c) error(400, 'Customer not found');

	const system = [
		'You draft estimate line items for a field service company.',
		'Reply with ONLY JSON: {"items":[{"name":string,"qty":number,"unitPriceCents":number}]}.',
		'Rules: prefer pricebook names and prices when an item matches the work; qty is whole units',
		'(bill labor in hours when the catalog prices labor hourly); unitPriceCents is an integer in',
		'the smallest currency unit; at most 8 items; no markup explanations; if nothing applies,',
		'return {"items":[]}.'
	].join(' ');

	const user = JSON.stringify({
		customer: { name: c.name, type: c.type },
		jobType: jt?.name ?? null,
		notes: args.notes,
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
