import { and, asc, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	agreementPlan,
	customer,
	estimate,
	job,
	jobType,
	member,
	payment,
	serviceAgreement,
	user,
	outer
} from '#lib/server/db/schema.ts';

/** Completed jobs per day for the last 30 days (includes zero days). */
async function jobsByDay(orgId: string) {
	const rows = await db
		.select({
			day: sql<string>`to_char(${job.completedAt}, 'YYYY-MM-DD')`,
			count: sql<number>`count(*)`.mapWith(Number)
		})
		.from(job)
		.where(
			and(
				eq(job.organizationId, orgId),
				gte(job.completedAt, new Date(Date.now() - 30 * 86400_000))
			)
		)
		.groupBy(sql`to_char(${job.completedAt}, 'YYYY-MM-DD')`);
	const byDay = new Map(rows.map((r) => [r.day, r.count]));
	const out = [];
	for (let i = 29; i >= 0; i--) {
		const day = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
		out.push({ day, count: byDay.get(day) ?? 0 });
	}
	return out;
}

/** New customers per month for the last 12 months. */
async function newCustomersByMonth(orgId: string) {
	const since = new Date();
	since.setUTCMonth(since.getUTCMonth() - 12);
	return db
		.select({
			month: sql<string>`to_char(${customer.createdAt}, 'YYYY-MM')`,
			count: sql<number>`count(*)`.mapWith(Number)
		})
		.from(customer)
		.where(and(eq(customer.organizationId, orgId), gte(customer.createdAt, since)))
		.groupBy(sql`to_char(${customer.createdAt}, 'YYYY-MM')`)
		.orderBy(asc(sql`to_char(${customer.createdAt}, 'YYYY-MM')`));
}

/** Collected revenue per month for the last 12 months. */
async function revenueByMonth(orgId: string) {
	const since = new Date();
	since.setUTCMonth(since.getUTCMonth() - 12);
	return db
		.select({
			month: sql<string>`to_char(${payment.paidAt}, 'YYYY-MM')`,
			total: sql<number>`sum(${payment.amount})`.mapWith(Number)
		})
		.from(payment)
		.where(and(eq(payment.organizationId, orgId), gte(payment.paidAt, since)))
		.groupBy(sql`to_char(${payment.paidAt}, 'YYYY-MM')`)
		.orderBy(asc(sql`to_char(${payment.paidAt}, 'YYYY-MM')`));
}

/** Active agreement count per plan. */
async function agreementsByPlan(orgId: string) {
	return db
		.select({
			planName: agreementPlan.name,
			count: sql<number>`count(*)`.mapWith(Number)
		})
		.from(serviceAgreement)
		.innerJoin(agreementPlan, eq(serviceAgreement.planId, agreementPlan.id))
		.where(and(eq(serviceAgreement.organizationId, orgId), eq(serviceAgreement.status, 'active')))
		.groupBy(agreementPlan.name)
		.orderBy(desc(sql`count(*)`));
}

/** Jobs per job type over the last 30 days, with completion rate. */
async function jobsByType(orgId: string) {
	return db
		.select({
			typeName: jobType.name,
			color: jobType.color,
			jobs: sql<number>`count(*)`.mapWith(Number),
			done: sql<number>`count(*) filter (where ${outer(job.status)} = 'done')`.mapWith(Number)
		})
		.from(job)
		.innerJoin(jobType, eq(job.jobTypeId, jobType.id))
		.where(
			and(
				eq(job.organizationId, orgId),
				isNull(job.cancelledAt),
				gte(job.createdAt, new Date(Date.now() - 30 * 86400_000))
			)
		)
		.groupBy(jobType.name, jobType.color)
		.orderBy(desc(sql`count(*)`));
}

/** Estimate funnel: counts by status plus approval rate on decided estimates. */
async function estimateFunnel(orgId: string) {
	const rows = await db
		.select({
			status: estimate.status,
			count: sql<number>`count(*)`.mapWith(Number),
			total:
				sql<number>`coalesce(sum((select sum(i.qty * i.unit_price) from estimate_item i where i.estimate_id = ${outer(estimate.id)})), 0)`.mapWith(
					Number
				)
		})
		.from(estimate)
		.where(eq(estimate.organizationId, orgId))
		.groupBy(estimate.status);
	return rows;
}

/** Per-technician workload over the last 30 days. */
async function technicianLoad(orgId: string) {
	return db
		.select({
			name: user.name,
			jobs: sql<number>`count(*)`.mapWith(Number),
			done: sql<number>`count(*) filter (where ${outer(job.status)} = 'done')`.mapWith(Number)
		})
		.from(job)
		.innerJoin(member, eq(job.technicianId, member.id))
		.innerJoin(user, eq(member.userId, user.id))
		.where(
			and(
				eq(job.organizationId, orgId),
				isNull(job.cancelledAt),
				gte(job.createdAt, new Date(Date.now() - 30 * 86400_000))
			)
		)
		.groupBy(user.name)
		.orderBy(desc(sql`count(*)`));
}

export async function getReports(orgId: string) {
	const [completedJobs, customers, revenue, plans, byType, estimates, techs] = await Promise.all([
		jobsByDay(orgId),
		newCustomersByMonth(orgId),
		revenueByMonth(orgId),
		agreementsByPlan(orgId),
		jobsByType(orgId),
		estimateFunnel(orgId),
		technicianLoad(orgId)
	]);
	return { completedJobs, customers, revenue, plans, byType, estimates, techs };
}
