import { error } from '@sveltejs/kit';
import { and, eq, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { db } from '../db/index.ts';
import { customer, jobType } from '../db/schema.ts';
import type { OrgContext } from '../context.ts';
import { addServiceLocation, createCustomer } from '../services/customers.ts';
import { createJob } from '../services/jobs.ts';
import { getSettings } from '../services/settings.ts';
import { aiDecision, aiDecisionAvailable, aiDecisionModel } from './ai.ts';

export type IntakeDraft = {
	customer: { name: string; companyName: string; phone: string; email: string };
	address: { line1: string; city: string; state: string; zip: string } | null;
	jobTypeId: string | null;
	summary: string;
	description: string;
	priority: 'low' | 'normal' | 'high' | 'urgent';
};

export type IntakeResult = {
	draft: IntakeDraft;
	/** Existing customer matched on email or phone digits — reused instead of a new row. */
	matchedCustomerId: string | null;
	matchedCustomerName: string | null;
	model: string;
};

/**
 * Turns pasted call notes / a voicemail transcript / an email into a job
 * intake draft. The model only sees the org's job types (for picking a
 * jobTypeId); everything else is extracted from the text. An existing
 * customer is matched server-side on email or phone digits so the UI can
 * offer "use existing" instead of duplicating.
 */
const optText = (fallback = '') => v.fallback(v.string(), fallback);

const intakeResponse = v.object({
	customer: v.fallback(
		v.object({
			name: optText(),
			companyName: optText(),
			phone: optText(),
			email: optText()
		}),
		{ name: '', companyName: '', phone: '', email: '' }
	),
	address: v.fallback(
		v.nullish(
			v.object({
				line1: optText(),
				city: optText(),
				state: optText(),
				zip: optText()
			})
		),
		null
	),
	jobTypeId: v.fallback(v.nullish(v.string()), null),
	summary: optText(),
	description: optText(),
	priority: v.fallback(v.picklist(['low', 'normal', 'high', 'urgent']), 'normal')
});

export async function parseJobIntake(orgId: string, notes: string): Promise<IntakeResult> {
	if (!aiDecisionAvailable())
		error(
			403,
			'No AI provider configured — set TREDARO_AI_MODEL and an API key or a custom endpoint'
		);

	const types = await db
		.select({ id: jobType.id, name: jobType.name })
		.from(jobType)
		.where(and(eq(jobType.organizationId, orgId), eq(jobType.active, true)));

	const system = [
		'You convert raw call notes into a field-service job intake.',
		'Reply with ONLY JSON: {"customer":{"name":string,"companyName":string,"phone":string,',
		'"email":string},"address":{"line1":string,"city":string,"state":string,"zip":string}|null,',
		'"jobTypeId":string|null,"summary":string,"description":string,"priority":"low"|"normal"|"high"|"urgent"}.',
		'Rules: pick jobTypeId ONLY from the provided job types (null if none fit);',
		'summary is a short problem line for the job title; description holds the details;',
		'leave strings empty when unknown; priority is "normal" unless the notes say otherwise.'
	].join(' ');

	const user = JSON.stringify({
		notes: notes.slice(0, 4000),
		jobTypes: types.slice(0, 60)
	});

	const parsed = await aiDecision(intakeResponse, system, user, { maxTokens: 1200 });
	const draft = toDraft(parsed, types);
	const match =
		draft.customer.email || digits(draft.customer.phone).length >= 7
			? await matchCustomer(orgId, draft)
			: null;
	return {
		draft,
		matchedCustomerId: match?.id ?? null,
		matchedCustomerName: match?.name ?? null,
		model: aiDecisionModel()
	};
}

/** Creates (or reuses the matched) customer, an optional service location, and the job. */
export async function createIntake(
	ctx: OrgContext,
	draft: IntakeDraft,
	matchedCustomerId: string | null
): Promise<{ jobId: string; customerId: string }> {
	if (!aiDecisionAvailable())
		error(
			403,
			'No AI provider configured — set TREDARO_AI_MODEL and an API key or a custom endpoint'
		);
	const name = draft.customer.name.trim() || draft.customer.companyName.trim();
	if (!name) error(400, 'A customer name is required');

	let customerId = matchedCustomerId;
	if (!customerId) {
		const c = await createCustomer(ctx, {
			name,
			companyName: draft.customer.companyName || null,
			phone: draft.customer.phone || null,
			email: draft.customer.email || '',
			type: draft.customer.companyName ? 'commercial' : 'residential',
			status: 'active',
			leadSource: 'AI intake',
			tags: [],
			smsOptOut: false,
			emailOptOut: false,
			onHold: false,
			doNotService: false,
			taxExempt: false
		});
		customerId = c.id;
	}

	let serviceLocationId: string | null = null;
	const a = draft.address;
	if (a && (a.line1 || a.city || a.zip)) {
		const loc = await addServiceLocation(ctx, {
			customerId,
			label: '',
			address1: a.line1,
			city: a.city,
			state: a.state,
			zip: a.zip,
			accessNotes: '',
			isPrimary: true
		});
		serviceLocationId = loc.id;
	}

	const tz = (await getSettings(ctx.orgId)).timezone;
	const j = await createJob(
		ctx,
		tz,
		{
			customerId,
			serviceLocationId,
			jobTypeId: draft.jobTypeId,
			summary: draft.summary.slice(0, 300),
			description: draft.description.slice(0, 5000),
			priority: draft.priority,
			preferredTime: null,
			tags: []
		},
		{ source: 'manual' }
	);
	return { jobId: j.id, customerId };
}

async function matchCustomer(orgId: string, draft: IntakeDraft) {
	const email = draft.customer.email.trim().toLowerCase();
	const d = digits(draft.customer.phone).slice(-10);
	if (!email && d.length < 7) return null;
	const [row] = await db
		.select({ id: customer.id, name: customer.name })
		.from(customer)
		.where(
			and(
				eq(customer.organizationId, orgId),
				email || d.length >= 7
					? sql`(${email ? sql`lower(${customer.email}) = ${email}` : sql`false`} or ${d.length >= 7 ? sql`regexp_replace(coalesce(${customer.phone}, ''), '[^0-9]', '', 'g') like ${'%' + d}` : sql`false`})`
					: sql`false`
			)
		)
		.limit(1);
	return row ?? null;
}

function digits(s: string): string {
	return s.replace(/[^0-9]/g, '');
}
function toDraft(
	parsed: v.InferOutput<typeof intakeResponse> | null,
	types: { id: string; name: string }[]
): IntakeDraft {
	const empty: IntakeDraft = {
		customer: { name: '', companyName: '', phone: '', email: '' },
		address: null,
		jobTypeId: null,
		summary: '',
		description: '',
		priority: 'normal'
	};
	if (!parsed) return empty;
	const typeIds = new Set(types.map((t) => t.id));
	const str = (x: string, max = 300) => x.trim().slice(0, max);
	const c = parsed.customer;
	const a = parsed.address ?? null;
	return {
		customer: {
			name: str(c.name, 200),
			companyName: str(c.companyName, 200),
			phone: str(c.phone, 40),
			email: str(c.email, 200)
		},
		address: a
			? {
					line1: str(a.line1, 300),
					city: str(a.city, 100),
					state: str(a.state, 50),
					zip: str(a.zip, 20)
				}
			: null,
		jobTypeId: parsed.jobTypeId && typeIds.has(parsed.jobTypeId) ? parsed.jobTypeId : null,
		summary: str(parsed.summary),
		description: str(parsed.description, 5000),
		priority: parsed.priority
	};
}
