/* @license Enterprise */

import { error } from '@sveltejs/kit';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { customer, jobType } from '../db/schema.ts';
import type { OrgContext } from '../context.ts';
import { addServiceLocation, createCustomer } from '../services/customers.ts';
import { createJob } from '../services/jobs.ts';
import { getSettings } from '../services/settings.ts';
import { aiAvailable, aiChat, aiModel } from './ai.ts';

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
export async function parseJobIntake(orgId: string, notes: string): Promise<IntakeResult> {
	if (!aiAvailable()) error(403, 'AI requires Tredaro Cloud or an enterprise license');

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

	const text = await aiChat(
		[
			{ role: 'system', content: system },
			{ role: 'user', content: user }
		],
		{ maxTokens: 1200 }
	);
	const draft = parseDraft(text, types);
	const match =
		draft.customer.email || digits(draft.customer.phone).length >= 7
			? await matchCustomer(orgId, draft)
			: null;
	return {
		draft,
		matchedCustomerId: match?.id ?? null,
		matchedCustomerName: match?.name ?? null,
		model: aiModel()
	};
}

/** Creates (or reuses the matched) customer, an optional service location, and the job. */
export async function createIntake(
	ctx: OrgContext,
	draft: IntakeDraft,
	matchedCustomerId: string | null
): Promise<{ jobId: string; customerId: string }> {
	if (!aiAvailable()) error(403, 'AI requires Tredaro Cloud or an enterprise license');
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

const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);

export function parseDraft(text: string, types: { id: string; name: string }[]): IntakeDraft {
	const empty: IntakeDraft = {
		customer: { name: '', companyName: '', phone: '', email: '' },
		address: null,
		jobTypeId: null,
		summary: '',
		description: '',
		priority: 'normal'
	};
	const start = text.search(/[[{]/);
	if (start < 0) return empty;
	let parsed: Record<string, unknown> | null = null;
	for (const end of [text.length, ...closingOffsets(text, start).slice(0, 40)]) {
		try {
			const p = JSON.parse(text.slice(start, end));
			if (p && typeof p === 'object' && !Array.isArray(p)) {
				parsed = p as Record<string, unknown>;
				break;
			}
		} catch {
			/* shrink and retry */
		}
	}
	if (!parsed) return empty;
	const typeIds = new Set(types.map((t) => t.id));
	const c = (parsed.customer ?? {}) as Record<string, unknown>;
	const a = (parsed.address ?? null) as Record<string, unknown> | null;
	const str = (x: unknown, max = 300) => (typeof x === 'string' ? x.trim().slice(0, max) : '');
	const jobTypeId = typeIds.has(String(parsed.jobTypeId)) ? String(parsed.jobTypeId) : null;
	return {
		customer: {
			name: str(c.name, 200),
			companyName: str(c.companyName, 200),
			phone: str(c.phone, 40),
			email: str(c.email, 200)
		},
		address:
			a && typeof a === 'object'
				? {
						line1: str(a.line1, 300),
						city: str(a.city, 100),
						state: str(a.state, 50),
						zip: str(a.zip, 20)
					}
				: null,
		jobTypeId,
		summary: str(parsed.summary),
		description: str(parsed.description, 5000),
		priority: PRIORITIES.has(String(parsed.priority))
			? (parsed.priority as IntakeDraft['priority'])
			: 'normal'
	};
}

function closingOffsets(text: string, start: number): number[] {
	const out: number[] = [];
	for (let i = text.length - 1; i > start; i--)
		if (text[i] === '}' || text[i] === ']') out.push(i + 1);
	return out;
}
