import { and, asc, desc, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	agreementPlan,
	charge,
	customer,
	estimate,
	job,
	jobTimeEntry,
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

/** Hours logged per technician over the last 30 days (open timers count to now). */
async function laborByTechnician(orgId: string) {
	const minutes = sql`sum(extract(epoch from (coalesce(${jobTimeEntry.endedAt}, now()) - ${jobTimeEntry.startedAt})) / 60)`;
	return db
		.select({
			memberId: member.id,
			name: user.name,
			jobs: sql<number>`count(distinct ${jobTimeEntry.jobId})`.mapWith(Number),
			entries: sql<number>`count(*)`.mapWith(Number),
			minutes: sql<number>`${minutes}`.mapWith(Number),
			open: sql<number>`count(*) filter (where ${jobTimeEntry.endedAt} is null)`.mapWith(Number)
		})
		.from(jobTimeEntry)
		.innerJoin(member, eq(jobTimeEntry.memberId, member.id))
		.innerJoin(user, eq(member.userId, user.id))
		.where(
			and(
				eq(jobTimeEntry.organizationId, orgId),
				gte(jobTimeEntry.startedAt, new Date(Date.now() - 30 * 86400_000))
			)
		)
		.groupBy(member.id, user.name)
		.orderBy(desc(minutes));
}

/** Per-technician performance over the last 90 days: completed jobs, logged hours, revenue collected on their jobs. */
async function techPerformance(orgId: string) {
	const since = new Date(Date.now() - 90 * 86400_000);
	const [done, hours, revenue] = await Promise.all([
		db
			.select({
				memberId: job.technicianId,
				jobs: sql<number>`count(*)`.mapWith(Number)
			})
			.from(job)
			.where(
				and(
					eq(job.organizationId, orgId),
					isNotNull(job.technicianId),
					isNull(job.cancelledAt),
					gte(job.completedAt, since)
				)
			)
			.groupBy(job.technicianId),
		db
			.select({
				memberId: jobTimeEntry.memberId,
				minutes:
					sql<number>`sum(extract(epoch from (coalesce(${jobTimeEntry.endedAt}, now()) - ${jobTimeEntry.startedAt})) / 60)`.mapWith(
						Number
					)
			})
			.from(jobTimeEntry)
			.where(and(eq(jobTimeEntry.organizationId, orgId), gte(jobTimeEntry.startedAt, since)))
			.groupBy(jobTimeEntry.memberId),
		db
			.select({
				memberId: job.technicianId,
				total: sql<number>`sum(${payment.amount})`.mapWith(Number)
			})
			.from(payment)
			.innerJoin(charge, eq(payment.chargeId, charge.id))
			.innerJoin(job, eq(charge.jobId, job.id))
			.where(
				and(
					eq(payment.organizationId, orgId),
					gte(payment.paidAt, since),
					isNotNull(job.technicianId)
				)
			)
			.groupBy(job.technicianId)
	]);
	const ids = new Set(
		[...done, ...hours, ...revenue].map((r) => r.memberId).filter((x): x is string => !!x)
	);
	if (!ids.size) return [];
	const names = new Map(
		(
			await db
				.select({ memberId: member.id, name: user.name })
				.from(member)
				.innerJoin(user, eq(member.userId, user.id))
				.where(eq(member.organizationId, orgId))
		).map((r) => [r.memberId, r.name])
	);
	const doneMap = new Map(done.map((r) => [r.memberId, r.jobs]));
	const hoursMap = new Map(hours.map((r) => [r.memberId, r.minutes]));
	const revMap = new Map(revenue.map((r) => [r.memberId, r.total]));
	return [...ids]
		.map((memberId) => ({
			memberId,
			name: names.get(memberId) ?? 'Former staff',
			jobsDone: doneMap.get(memberId) ?? 0,
			minutes: hoursMap.get(memberId) ?? 0,
			revenue: revMap.get(memberId) ?? 0
		}))
		.sort((a, b) => b.revenue - a.revenue || b.jobsDone - a.jobsDone);
}

export async function getReports(orgId: string) {
	const [completedJobs, customers, revenue, plans, byType, estimates, techs, labor, perf] =
		await Promise.all([
			jobsByDay(orgId),
			newCustomersByMonth(orgId),
			revenueByMonth(orgId),
			agreementsByPlan(orgId),
			jobsByType(orgId),
			estimateFunnel(orgId),
			technicianLoad(orgId),
			laborByTechnician(orgId),
			techPerformance(orgId)
		]);
	return { completedJobs, customers, revenue, plans, byType, estimates, techs, labor, perf };
}
