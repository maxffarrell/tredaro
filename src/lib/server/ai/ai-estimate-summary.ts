import { error } from '@sveltejs/kit';
import { getEstimate } from '../services/estimates.ts';
import { aiAvailable, aiChat, aiModel } from './ai.ts';

/**
 * Drafts a short customer-facing cover note for an estimate — what the quote
 * covers, in plain language — from the estimate's line items. Staff paste it
 * into the estimate notes (shown on the public /e/[token] page).
 */
export async function suggestEstimateSummary(
	orgId: string,
	estimateId: string
): Promise<{ summary: string; model: string }> {
	if (!aiAvailable())
		error(
			403,
			'No AI provider configured — set TREDARO_AI_MODEL and an API key or a custom endpoint'
		);

	const est = await getEstimate(orgId, estimateId);

	const system = [
		'You write short cover notes on field-service estimates for the customer.',
		'Reply with 2-4 plain sentences: what work the quote covers and why it helps.',
		'No prices, no SKUs, no jargon, no markdown, no greeting or sign-off.',
		'No headings or bullet lists — just the paragraph.'
	].join(' ');

	const user = JSON.stringify({
		customer: est.customer.name,
		items: est.items.slice(0, 20).map((i) => ({
			name: i.item.name || i.pricebookName,
			qty: i.item.qty,
			optionGroup: i.item.optionGroup || null
		}))
	});

	const text = await aiChat(
		[
			{ role: 'system', content: system },
			{ role: 'user', content: user }
		],
		{ maxTokens: 500 }
	);
	const summary = text.trim().slice(0, 2000);
	if (!summary) error(502, 'Model returned an empty summary');
	return { summary, model: aiModel() };
}
