import { error } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { customer, invoice, job, serviceAgreement } from '../db/schema.ts';
import { aiAvailable, aiChat, aiModel } from './ai.ts';

/**
 * A short CSR brief on a customer — who they are, history, open items —
 * gathered from their jobs, invoices, and agreements. Rendered in a dialog
 * from the customer page so a rep can skim before a call.
 */
export async function customerBrief(
	orgId: string,
	customerId: string
): Promise<{ brief: string; model: string }> {
	if (!aiAvailable())
		error(
			403,
			'No AI provider configured — set TREDARO_AI_MODEL and an API key or a custom endpoint'
		);

	const [c] = await db
		.select()
		.from(customer)
		.where(and(eq(customer.organizationId, orgId), eq(customer.id, customerId)));
	if (!c) error(404, 'Customer not found');

	const [jobs, invoices, agreements] = await Promise.all([
		db
			.select({
				number: job.number,
				status: job.status,
				summary: job.summary,
				startsAt: job.startsAt
			})
			.from(job)
			.where(and(eq(job.organizationId, orgId), eq(job.customerId, customerId)))
			.orderBy(desc(job.startsAt))
			.limit(12),
		db
			.select({ status: invoice.status, notes: invoice.notes })
			.from(invoice)
			.where(and(eq(invoice.organizationId, orgId), eq(invoice.customerId, customerId)))
			.limit(20),
		db
			.select({ status: serviceAgreement.status })
			.from(serviceAgreement)
			.where(
				and(eq(serviceAgreement.organizationId, orgId), eq(serviceAgreement.customerId, customerId))
			)
			.limit(10)
	]);

	const system = [
		'You brief a customer-service rep before a call with a field-service customer.',
		'Reply with 3-5 plain sentences: relationship so far, recent work, anything open',
		'(unpaid invoices, upcoming visits, agreements), and one suggested next step.',
		'No markdown, lists, or dollar figures beyond what the data shows.'
	].join(' ');

	const user = JSON.stringify({
		customer: {
			name: c.name,
			type: c.type,
			companyName: c.companyName,
			since: c.since,
			tags: c.tags,
			notes: c.notes?.slice(0, 500)
		},
		recentJobs: jobs.map((j) => ({
			number: j.number,
			status: j.status,
			summary: j.summary,
			startsAt: j.startsAt
		})),
		invoices: invoices.length,
		openInvoices: invoices.filter((i) => i.status === 'open').length,
		activeAgreements: agreements.filter((a) => a.status === 'active').length
	});

	const text = await aiChat(
		[
			{ role: 'system', content: system },
			{ role: 'user', content: user }
		],
		{ maxTokens: 600 }
	);
	const brief = text.trim().slice(0, 2000);
	if (!brief) error(502, 'Model returned an empty brief');
	return { brief, model: aiModel() };
}
