import { command, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { requireOrg } from '#lib/server/context.ts';
import { idSchema } from '#lib/schemas.ts';
import { aiAvailable } from '#lib/server/ee/ai.ts';
import { suggestInvoiceItems } from '#lib/server/ee/ai-invoice.ts';
import { suggestEstimateItems } from '#lib/server/ee/ai-estimate.ts';
import { suggestServiceSummary } from '#lib/server/ee/ai-summary.ts';
import { suggestDispatch } from '#lib/server/ee/ai-dispatch.ts';
import { draftPricebookItems } from '#lib/server/ee/ai-pricebook.ts';
import * as v from 'valibot';

/** Whether enterprise AI is licensed and an endpoint is configured. */
export const getAiStatus = query(async () => {
	await requireOrg();
	return { available: aiAvailable() };
});

/** AI-drafted line items for invoicing a job. Enterprise + configured endpoint required. */
export const aiInvoiceSuggestions = command(idSchema, async (jobId) => {
	const { orgId } = await requireOrg();
	if (!aiAvailable()) {
		error(
			403,
			'AI requires Tredaro Cloud or an enterprise license — then set TREDARO_AI_API_KEY and TREDARO_AI_MODEL'
		);
	}
	return suggestInvoiceItems(orgId, jobId);
});

/** AI-drafted line items for a new estimate. Enterprise + configured endpoint required. */
export const aiEstimateSuggestions = command(
	v.object({
		customerId: idSchema,
		jobTypeId: v.optional(v.nullable(idSchema)),
		notes: v.optional(v.string(), '')
	}),
	async (input) => {
		const { orgId } = await requireOrg();
		if (!aiAvailable()) {
			error(
				403,
				'AI requires Tredaro Cloud or an enterprise license — then set TREDARO_AI_API_KEY and TREDARO_AI_MODEL'
			);
		}
		return suggestEstimateItems(orgId, {
			customerId: input.customerId,
			jobTypeId: input.jobTypeId ?? null,
			notes: input.notes ?? ''
		});
	}
);

/** AI-drafted customer-facing visit recap for a job. Enterprise + configured endpoint required. */
export const aiServiceSummary = command(idSchema, async (jobId) => {
	const { orgId } = await requireOrg();
	if (!aiAvailable()) {
		error(
			403,
			'AI requires Tredaro Cloud or an enterprise license — then set TREDARO_AI_API_KEY and TREDARO_AI_MODEL'
		);
	}
	return suggestServiceSummary(orgId, jobId);
});

/** AI-suggested tech assignments for the unscheduled queue on a day (YYYY-MM-DD). */
export const aiDispatchSuggestion = command(v.object({ day: v.string() }), async ({ day }) => {
	const { orgId } = await requireOrg();
	if (!aiAvailable()) {
		error(
			403,
			'AI requires Tredaro Cloud or an enterprise license — then set TREDARO_AI_API_KEY and TREDARO_AI_MODEL'
		);
	}
	return suggestDispatch(orgId, day);
});

/** AI-drafted pricebook items from a free-text description. */
export const aiPricebookDraft = command(
	v.object({ prompt: v.pipe(v.string(), v.minLength(3), v.maxLength(4000)) }),
	async ({ prompt }) => {
		const { orgId } = await requireOrg();
		if (!aiAvailable()) {
			error(
				403,
				'AI requires Tredaro Cloud or an enterprise license — then set TREDARO_AI_API_KEY and TREDARO_AI_MODEL'
			);
		}
		return draftPricebookItems(orgId, prompt);
	}
);
