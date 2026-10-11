import { command, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { requireOrg } from '#lib/server/context.ts';
import { idSchema } from '#lib/schemas.ts';
import { aiAvailable, aiDecisionAvailable } from '#lib/server/ai/ai.ts';
import { suggestInvoiceItems } from '#lib/server/ai/ai-invoice.ts';
import { suggestEstimateItems } from '#lib/server/ai/ai-estimate.ts';
import { suggestServiceSummary } from '#lib/server/ai/ai-summary.ts';
import { suggestDispatch } from '#lib/server/ai/ai-dispatch.ts';
import { draftPricebookItems } from '#lib/server/ai/ai-pricebook.ts';
import { parseJobIntake, createIntake } from '#lib/server/ai/ai-intake.ts';
import { draftChecklist } from '#lib/server/ai/ai-checklist.ts';
import { suggestEstimateSummary } from '#lib/server/ai/ai-estimate-summary.ts';
import { customerBrief } from '#lib/server/ai/ai-brief.ts';
import { suggestMaterials } from '#lib/server/ai/ai-materials.ts';
import { suggestTiers } from '#lib/server/ai/ai-tiers.ts';
import * as v from 'valibot';

const AI_GATE = 'Configure TREDARO_AI_MODEL and an API key or a custom endpoint';
const AI_DECISION_GATE =
	'Configure TREDARO_AI_MODEL and an API key or a custom endpoint (or the TREDARO_AI_DECISION_* overrides)';

/** Whether a BYOK AI endpoint is configured. */
export const getAiStatus = query(async () => {
	await requireOrg();
	return {
		available: aiAvailable() || aiDecisionAvailable(),
		decisionAvailable: aiDecisionAvailable()
	};
});

/** AI-drafted line items for invoicing a job. Configured BYOK endpoint required. */
export const aiInvoiceSuggestions = command(idSchema, async (jobId) => {
	const { orgId } = await requireOrg();
	if (!aiDecisionAvailable()) error(400, AI_DECISION_GATE);
	return suggestInvoiceItems(orgId, jobId);
});

/** AI-drafted line items for a new estimate. Configured BYOK endpoint required. */
export const aiEstimateSuggestions = command(
	v.object({
		customerId: idSchema,
		jobTypeId: v.optional(v.nullable(idSchema)),
		notes: v.optional(v.string(), '')
	}),
	async (input) => {
		const { orgId } = await requireOrg();
		if (!aiDecisionAvailable()) error(400, AI_DECISION_GATE);
		return suggestEstimateItems(orgId, {
			customerId: input.customerId,
			jobTypeId: input.jobTypeId ?? null,
			notes: input.notes ?? ''
		});
	}
);

/** AI-drafted customer-facing visit recap for a job. Configured BYOK endpoint required. */
export const aiServiceSummary = command(idSchema, async (jobId) => {
	const { orgId } = await requireOrg();
	if (!aiAvailable()) {
		error(403, 'Configure TREDARO_AI_MODEL and an API key or a custom endpoint');
	}
	return suggestServiceSummary(orgId, jobId);
});

/** AI-suggested tech assignments for the unscheduled queue on a day (YYYY-MM-DD). */
export const aiDispatchSuggestion = command(v.object({ day: v.string() }), async ({ day }) => {
	const { orgId } = await requireOrg();
	if (!aiDecisionAvailable()) error(400, AI_DECISION_GATE);
	return suggestDispatch(orgId, day);
});

/** AI-drafted pricebook items from a free-text description. */
export const aiPricebookDraft = command(
	v.object({ prompt: v.pipe(v.string(), v.minLength(3), v.maxLength(4000)) }),
	async ({ prompt }) => {
		const { orgId } = await requireOrg();
		if (!aiDecisionAvailable()) error(400, AI_DECISION_GATE);
		return draftPricebookItems(orgId, prompt);
	}
);

/** AI job intake: pasted call notes → customer/location/job draft (plus existing-customer match). */
export const aiJobIntake = command(
	v.object({ notes: v.pipe(v.string(), v.minLength(5), v.maxLength(4000)) }),
	async ({ notes }) => {
		const { orgId } = await requireOrg();
		if (!aiDecisionAvailable()) error(400, AI_DECISION_GATE);
		return parseJobIntake(orgId, notes);
	}
);

const intakeDraftSchema = v.object({
	customer: v.object({
		name: v.pipe(v.string(), v.maxLength(200)),
		companyName: v.pipe(v.string(), v.maxLength(200)),
		phone: v.pipe(v.string(), v.maxLength(40)),
		email: v.pipe(v.string(), v.maxLength(200))
	}),
	address: v.nullable(
		v.object({
			line1: v.pipe(v.string(), v.maxLength(300)),
			city: v.pipe(v.string(), v.maxLength(100)),
			state: v.pipe(v.string(), v.maxLength(50)),
			zip: v.pipe(v.string(), v.maxLength(20))
		})
	),
	jobTypeId: v.nullable(idSchema),
	summary: v.pipe(v.string(), v.maxLength(300)),
	description: v.pipe(v.string(), v.maxLength(5000)),
	priority: v.picklist(['low', 'normal', 'high', 'urgent'])
});

/** Creates the customer (or reuses the matched one), location, and job from an intake draft. */
export const aiIntakeCreate = command(
	v.object({ draft: intakeDraftSchema, matchedCustomerId: v.nullable(idSchema) }),
	async ({ draft, matchedCustomerId }) => {
		const ctx = await requireOrg();
		if (!aiDecisionAvailable()) error(400, AI_DECISION_GATE);
		// createJob/addServiceLocation re-verify the customer belongs to this org.
		return createIntake(ctx, draft, matchedCustomerId);
	}
);

/** AI-drafted checklist steps for a job type, from its name (+ optional context). */
export const aiChecklistDraft = command(
	v.object({
		name: v.pipe(v.string(), v.minLength(2), v.maxLength(200)),
		context: v.optional(v.pipe(v.string(), v.maxLength(2000)), '')
	}),
	async ({ name, context }) => {
		await requireOrg();
		if (!aiDecisionAvailable()) error(400, AI_DECISION_GATE);
		return draftChecklist(name, context ?? '');
	}
);

/** AI-drafted customer-facing cover note for an estimate. */
export const aiEstimateSummary = command(idSchema, async (estimateId) => {
	const { orgId } = await requireOrg();
	if (!aiAvailable()) error(400, AI_GATE);
	return suggestEstimateSummary(orgId, estimateId);
});

/** AI customer brief — a few sentences of history + open items for a CSR. */
export const aiCustomerBrief = command(idSchema, async (customerId) => {
	const { orgId } = await requireOrg();
	if (!aiAvailable()) error(400, AI_GATE);
	return customerBrief(orgId, customerId);
});

/** AI-suggested materials to load for a job, restricted to real inventory ids. */
export const aiSuggestMaterials = command(idSchema, async (jobId) => {
	const { orgId } = await requireOrg();
	if (!aiDecisionAvailable()) error(400, AI_DECISION_GATE);
	return suggestMaterials(orgId, jobId);
});

/** AI-named option tiers (good/better/best) grouping an estimate's line items. */
export const aiEstimateTiers = command(
	v.object({
		items: v.pipe(
			v.array(
				v.object({
					name: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
					unitPrice: v.number(),
					qty: v.number()
				})
			),
			v.minLength(1)
		)
	}),
	async ({ items }) => {
		await requireOrg();
		if (!aiDecisionAvailable()) error(400, AI_DECISION_GATE);
		return suggestTiers(items);
	}
);
