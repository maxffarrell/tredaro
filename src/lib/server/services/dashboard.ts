import { and, asc, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	activity,
	charge,
	companySettings,
	customer,
	job,
	jobType,
	member,
	payment,
	serviceAgreement,
	user,
	outer
} from '#lib/server/db/schema.ts';
import { monthlyRecurring } from './billing.ts';
import { localDate, zonedToUtc } from '#lib/tz.ts';

/** KPIs, today's route and unscheduled queue for the dashboard. */
export async function dashboard(orgId: string) {
	const [settings] = await db
		.select()
		.from(companySettings)
		.where(eq(companySettings.organizationId, orgId));
	const tz = settings?.timezone ?? 'UTC';
	const today = localDate(new Date(), tz);
	const dayStart = zonedToUtc(`${today}T00:00`, tz);
	const dayEnd = new Date(dayStart.getTime() + 86400_000);

	const [customerStats] = await db
		.select({
			active: sql<number>`count(*) filter (where ${outer(customer.status)} = 'active')`.mapWith(
				Number
			),
			newThisMonth:
				sql<number>`count(*) filter (where ${outer(customer.createdAt)} >= ${today.slice(0, 8) + '01'})`.mapWith(
					Number
				)
		})
		.from(customer)
		.where(eq(customer.organizationId, orgId));

	const [jobStats] = await db
		.select({
			unscheduled:
				sql<number>`count(*) filter (where ${outer(job.status)} = 'unscheduled')`.mapWith(Number),
			inFlight:
				sql<number>`count(*) filter (where ${outer(job.status)} in ('dispatched','in_progress'))`.mapWith(
					Number
				),
			doneToday:
				sql<number>`count(*) filter (where ${outer(job.completedAt)} >= ${dayStart.toISOString()} and ${outer(job.completedAt)} < ${dayEnd.toISOString()})`.mapWith(
					Number
				)
		})
		.from(job)
		.where(and(eq(job.organizationId, orgId), isNull(job.cancelledAt)));

	const [agreementStats] = await db
		.select({ active: sql<number>`count(*)`.mapWith(Number) })
		.from(serviceAgreement)
		.where(and(eq(serviceAgreement.organizationId, orgId), eq(serviceAgreement.status, 'active')));

	const [openStats] = await db
		.select({
			openTotal:
				sql<number>`coalesce(sum(${outer(charge.amount)} - coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${outer(charge.id)}), 0)) filter (where ${outer(charge.status)} = 'open'), 0)`.mapWith(
					Number
				),
			overdueTotal:
				sql<number>`coalesce(sum(${outer(charge.amount)} - coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${outer(charge.id)}), 0)) filter (where ${outer(charge.status)} = 'open' and ${outer(charge.dueDate)} < ${today}), 0)`.mapWith(
					Number
				)
		})
		.from(charge)
		.where(eq(charge.organizationId, orgId));

	const mrr = await monthlyRecurring(orgId);

	const todayJobs = await db
		.select({
			id: job.id,
			number: job.number,
			summary: job.summary,
			status: job.status,
			startsAt: job.startsAt,
			endsAt: job.endsAt,
			priority: job.priority,
			jobTypeName: jobType.name,
			color: jobType.color,
			customerName: customer.name,
			technicianName: user.name
		})
		.from(job)
		.leftJoin(jobType, eq(job.jobTypeId, jobType.id))
		.innerJoin(customer, eq(job.customerId, customer.id))
		.leftJoin(member, eq(job.technicianId, member.id))
		.leftJoin(user, eq(member.userId, user.id))
		.where(
			and(
				eq(job.organizationId, orgId),
				isNull(job.cancelledAt),
				gte(job.startsAt, dayStart),
				lt(job.startsAt, dayEnd)
			)
		)
		.orderBy(asc(job.startsAt));

	const recentActivity = await db
		.select()
		.from(activity)
		.where(eq(activity.organizationId, orgId))
		.orderBy(desc(activity.createdAt))
		.limit(12);

	const recentCustomers = await db
		.select({ id: customer.id, name: customer.name, status: customer.status })
		.from(customer)
		.where(eq(customer.organizationId, orgId))
		.orderBy(desc(customer.createdAt))
		.limit(6);

	return {
		timezone: tz,
		currency: settings?.currency ?? 'usd',
		activeCustomers: customerStats?.active ?? 0,
		newThisMonth: customerStats?.newThisMonth ?? 0,
		unscheduledJobs: jobStats?.unscheduled ?? 0,
		inFlightJobs: jobStats?.inFlight ?? 0,
		doneToday: jobStats?.doneToday ?? 0,
		activeAgreements: agreementStats?.active ?? 0,
		openTotal: openStats?.openTotal ?? 0,
		overdueTotal: openStats?.overdueTotal ?? 0,
		mrr,
		todayJobs,
		recentActivity,
		recentCustomers
	};
}
