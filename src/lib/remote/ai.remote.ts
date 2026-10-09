import { command, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { requireOrg } from '#lib/server/context.ts';
import { idSchema } from '#lib/schemas.ts';
import { aiAvailable } from '#lib/server/ee/ai.ts';
import { suggestInvoiceItems } from '#lib/server/ee/ai-invoice.ts';
import { suggestEstimateItems } from '#lib/server/ee/ai-estimate.ts';
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
