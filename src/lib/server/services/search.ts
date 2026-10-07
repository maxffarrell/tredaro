import { and, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { customer, estimate, job, jobType, pricebookItem } from '#lib/server/db/schema.ts';

export type SearchHit = {
	kind: 'customer' | 'job' | 'estimate' | 'jobType' | 'pricebook';
	id: string;
	title: string;
	sub: string;
	href: string;
};

/** Command-palette search across customers, jobs, estimates, job types and pricebook items. */
export async function search(orgId: string, q: string): Promise<SearchHit[]> {
	const term = `%${q.trim()}%`;
	if (term === '%%') return [];
	const numMatch = /^[jei]-?(\d+)$/i.exec(q.trim());
	const [customers, jobs, estimates, types, items] = await Promise.all([
		db
			.select({
				id: customer.id,
				name: customer.name,
				email: customer.email,
				companyName: customer.companyName
			})
			.from(customer)
			.where(
				and(
					eq(customer.organizationId, orgId),
					or(
						ilike(customer.name, term),
						ilike(customer.email, term),
						ilike(customer.companyName, term),
						ilike(customer.phone, term)
					)
				)
			)
			.limit(5),
		db
			.select({ id: job.id, number: job.number, summary: job.summary })
			.from(job)
			.where(
				and(
					eq(job.organizationId, orgId),
					numMatch?.[1] && q.toLowerCase().startsWith('j')
						? eq(job.number, Number(numMatch[1]))
						: ilike(job.summary, term)
				)
			)
			.limit(5),
		db
			.select({ id: estimate.id, number: estimate.number })
			.from(estimate)
			.where(
				and(
					eq(estimate.organizationId, orgId),
					numMatch?.[1] && q.toLowerCase().startsWith('e')
						? eq(estimate.number, Number(numMatch[1]))
						: sql`false`
				)
			)
			.limit(5),
		db
			.select({ id: jobType.id, name: jobType.name })
			.from(jobType)
			.where(and(eq(jobType.organizationId, orgId), ilike(jobType.name, term)))
			.limit(5),
		db
			.select({ id: pricebookItem.id, name: pricebookItem.name, category: pricebookItem.category })
			.from(pricebookItem)
			.where(and(eq(pricebookItem.organizationId, orgId), ilike(pricebookItem.name, term)))
			.limit(5)
	]);
	return [
		...customers.map((m) => ({
			kind: 'customer' as const,
			id: m.id,
			title: m.name,
			sub: m.companyName || m.email || '',
			href: `/customers/${m.id}`
		})),
		...jobs.map((j) => ({
			kind: 'job' as const,
			id: j.id,
			title: `J-${j.number} ${j.summary}`,
			sub: 'Job',
			href: `/jobs/${j.id}`
		})),
		...estimates.map((e) => ({
			kind: 'estimate' as const,
			id: e.id,
			title: `Estimate E-${e.number}`,
			sub: 'Estimate',
			href: `/estimates/${e.id}`
		})),
		...types.map((t) => ({
			kind: 'jobType' as const,
			id: t.id,
			title: t.name,
			sub: 'Job type',
			href: `/jobs?type=${t.id}`
		})),
		...items.map((p) => ({
			kind: 'pricebook' as const,
			id: p.id,
			title: p.name,
			sub: p.category ?? 'Pricebook item',
			href: `/pricebook?item=${p.id}`
		}))
	];
}
export type { SearchHit as Hit };
