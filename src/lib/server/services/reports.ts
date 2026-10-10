import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	agreementPlan,
	charge,
	customer,
	estimate,
	estimateItem,
	invoice,
	invoiceItem,
	inventoryItem,
	jobExpense,
	jobMaterial,
	job,
	jobTimeEntry,
	jobType,
	member,
	office,
	payment,
	purchaseOrder,
	purchaseOrderItem,
	serviceAgreement,
	serviceLocation,
	user,
	outer
} from '#lib/server/db/schema.ts';
import { getSettings } from './settings.ts';

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

/**
 * Callbacks: done jobs that got another (non-cancelled) job at the same service
 * location within 30 days — a rework/callback proxy for service quality.
 */
async function callbackRate(orgId: string) {
	const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
	const [row] = await db
		.select({
			done: sql<number>`count(*)`.mapWith(Number),
			callbacks: sql<number>`count(*) filter (where exists (
					select 1 from job j2
					where j2.organization_id = job.organization_id
						and j2.service_location_id = job.service_location_id
						and j2.id <> job.id
						and j2.created_at > job.completed_at
						and j2.created_at <= job.completed_at + interval '30 days'
						and j2.cancelled_at is null
				))`.mapWith(Number)
		})
		.from(job)
		.where(
			and(
				eq(job.organizationId, orgId),
				eq(job.status, 'done'),
				isNull(job.cancelledAt),
				sql`${job.serviceLocationId} is not null`,
				gte(job.completedAt, since)
			)
		);
	const done = row?.done ?? 0;
	const callbacks = row?.callbacks ?? 0;
	return { done, callbacks, pct: done ? Math.round((callbacks / done) * 100) : 0 };
}

/** Collected revenue by day of week (org timezone), Mon..Sun. */
async function revenueByWeekday(orgId: string) {
	const tz = (await getSettings(orgId)).timezone;
	const rows = await db
		.select({
			dow: sql<number>`extract(isodow from timezone(${tz}, ${payment.paidAt}))`.mapWith(Number),
			cents: sql<number>`coalesce(sum(${payment.amount}), 0)`.mapWith(Number)
		})
		.from(payment)
		.where(eq(payment.organizationId, orgId))
		.groupBy(sql`1`);
	const byDay = new Array(7).fill(0);
	for (const r of rows) byDay[(r.dow - 1 + 7) % 7] = r.cents;
	return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, i) => ({
		label,
		cents: byDay[i]
	}));
}

/** Collected payments grouped by method (all time). */
async function paymentsByMethod(orgId: string) {
	return db
		.select({
			method: payment.method,
			count: sql<number>`count(*)`.mapWith(Number),
			total: sql<number>`sum(${payment.amount})`.mapWith(Number)
		})
		.from(payment)
		.where(eq(payment.organizationId, orgId))
		.groupBy(payment.method)
		.orderBy(desc(sql`sum(${payment.amount})`));
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

/** Avg span (min) of completed jobs over the last 30 days. */
async function avgJobMinutes(orgId: string) {
	const [{ v }] = await db
		.select({
			v: sql<number>`avg(extract(epoch from (${job.endsAt} - ${job.startsAt})) / 60)`.mapWith(
				Number
			)
		})
		.from(job)
		.where(
			and(
				eq(job.organizationId, orgId),
				eq(job.status, 'done'),
				isNotNull(job.startsAt),
				isNotNull(job.endsAt),
				gte(job.completedAt, new Date(Date.now() - 30 * 86400_000))
			)
		);
	return v ?? null;
}

/** Avg line items per non-draft estimate (90d). */
async function avgItemsPerEstimate(orgId: string) {
	const [{ v }] = await db
		.select({
			v: sql<number>`count(*) * 1.0 / nullif(count(distinct ${estimateItem.estimateId}), 0)`.mapWith(
				Number
			)
		})
		.from(estimateItem)
		.innerJoin(estimate, eq(estimateItem.estimateId, estimate.id))
		.where(
			and(
				eq(estimate.organizationId, orgId),
				ne(estimate.status, 'draft'),
				gte(estimate.createdAt, new Date(Date.now() - 90 * 86400_000))
			)
		);
	return v ?? null;
}

/** Share of jobs created in 30d that ended cancelled. */
async function cancelRate(orgId: string) {
	const [{ v }] = await db
		.select({
			v: sql<number>`count(*) filter (where ${job.status} = 'cancelled') * 100.0 / nullif(count(*) filter (where ${job.status} in ('done', 'cancelled')), 0)`.mapWith(
				Number
			)
		})
		.from(job)
		.where(
			and(eq(job.organizationId, orgId), gte(job.createdAt, new Date(Date.now() - 30 * 86400_000)))
		);
	return v ?? null;
}

/** Avg invoiced revenue per job (90d, non-void invoices linked to a job). */
async function avgJobValue(orgId: string) {
	const [{ v }] = await db
		.select({
			v: sql<number>`coalesce(sum(${invoiceItem.qty} * ${invoiceItem.unitPrice}), 0) / nullif(count(distinct ${invoice.jobId}), 0)`.mapWith(
				Number
			)
		})
		.from(invoiceItem)
		.innerJoin(invoice, eq(invoiceItem.invoiceId, invoice.id))
		.where(
			and(
				eq(invoice.organizationId, orgId),
				ne(invoice.status, 'void'),
				isNotNull(invoice.jobId),
				gte(invoice.createdAt, new Date(Date.now() - 90 * 86400_000))
			)
		);
	return v ?? null;
}

/** Repeat-customer rate: share of customers with a done job in 90d who have 2+ done jobs. */
async function repeatRate(orgId: string) {
	const rows = await db
		.select({
			customerId: job.customerId,
			n: sql<number>`count(*)`.mapWith(Number)
		})
		.from(job)
		.where(
			and(
				eq(job.organizationId, orgId),
				eq(job.status, 'done'),
				gte(job.completedAt, new Date(Date.now() - 90 * 86400_000)),
				isNotNull(job.customerId)
			)
		)
		.groupBy(job.customerId);
	if (!rows.length) return null;
	return {
		customers: rows.length,
		repeats: rows.filter((r) => r.n >= 2).length
	};
}

/** Avg days from estimate sent to decision (approved/converted/declined), via updated_at. */
async function avgDaysToEstimateDecision(orgId: string) {
	const [{ avg }] = await db
		.select({
			avg: sql<number>`avg(extract(epoch from (${estimate.updatedAt} - ${estimate.sentAt})) / 86400)`.mapWith(
				Number
			)
		})
		.from(estimate)
		.where(
			and(
				eq(estimate.organizationId, orgId),
				isNotNull(estimate.sentAt),
				inArray(estimate.status, ['approved', 'converted', 'declined'])
			)
		);
	return avg ?? null;
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
			open: sql<number>`count(*) filter (where ${jobTimeEntry.endedAt} is null)`.mapWith(Number),
			approvedMin:
				sql<number>`coalesce(sum(extract(epoch from (${jobTimeEntry.endedAt} - ${jobTimeEntry.startedAt})) / 60) filter (where ${jobTimeEntry.endedAt} is not null and ${jobTimeEntry.approvedAt} is not null), 0)`.mapWith(
					Number
				),
			unapprovedMin:
				sql<number>`coalesce(sum(extract(epoch from (${jobTimeEntry.endedAt} - ${jobTimeEntry.startedAt})) / 60) filter (where ${jobTimeEntry.endedAt} is not null and ${jobTimeEntry.approvedAt} is null), 0)`.mapWith(
					Number
				)
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

/** Last-30-days scheduled minutes (assigned job durations) vs logged minutes per tech. */
async function timesheetVariance(orgId: string) {
	const since = new Date(Date.now() - 30 * 86400_000);
	const [sched, logged, members] = await Promise.all([
		db
			.select({
				memberId: job.technicianId,
				minutes:
					sql<number>`coalesce(sum(extract(epoch from (${job.endsAt} - ${job.startsAt})) / 60), 0)`.mapWith(
						Number
					)
			})
			.from(job)
			.where(
				and(
					eq(job.organizationId, orgId),
					isNotNull(job.technicianId),
					isNotNull(job.endsAt),
					gte(job.startsAt, since),
					sql`${job.status} <> 'cancelled'`
				)
			)
			.groupBy(job.technicianId),
		db
			.select({
				memberId: jobTimeEntry.memberId,
				minutes:
					sql<number>`coalesce(sum(extract(epoch from (coalesce(${jobTimeEntry.endedAt}, now()) - ${jobTimeEntry.startedAt})) / 60), 0)`.mapWith(
						Number
					)
			})
			.from(jobTimeEntry)
			.where(
				and(
					eq(jobTimeEntry.organizationId, orgId),
					isNotNull(jobTimeEntry.memberId),
					gte(jobTimeEntry.startedAt, since)
				)
			)
			.groupBy(jobTimeEntry.memberId),
		db
			.select({ id: member.id, name: user.name })
			.from(member)
			.innerJoin(user, eq(member.userId, user.id))
			.where(eq(member.organizationId, orgId))
	]);
	const schedMap = new Map(sched.map((r) => [r.memberId, r.minutes]));
	const logMap = new Map(logged.map((r) => [r.memberId, r.minutes]));
	const r1 = (n: number) => Math.round(n * 10) / 10;
	return members
		.map((m) => {
			const s = schedMap.get(m.id) ?? 0;
			const l = logMap.get(m.id) ?? 0;
			if (!s && !l) return null;
			return {
				name: m.name,
				schedH: r1(s / 60),
				loggedH: r1(l / 60),
				varianceH: r1((l - s) / 60)
			};
		})
		.filter((r): r is NonNullable<typeof r> => !!r)
		.sort((a, b) => Math.abs(b.varianceH) - Math.abs(a.varianceH));
}

/** Next-7-days scheduled minutes per tech vs an 8h×7 capacity — dispatch load at a glance. */
async function utilization(orgId: string) {
	const now = new Date();
	const weekOut = new Date(now.getTime() + 7 * 86400_000);
	const minutes = sql`coalesce(sum(extract(epoch from (${job.endsAt} - ${job.startsAt})) / 60), 0)`;
	const rows = await db
		.select({
			memberId: member.id,
			name: user.name,
			minutes: sql<number>`${minutes}`.mapWith(Number)
		})
		.from(member)
		.innerJoin(user, eq(member.userId, user.id))
		.leftJoin(
			job,
			and(
				eq(job.technicianId, member.id),
				eq(job.organizationId, orgId),
				isNotNull(job.startsAt),
				isNotNull(job.endsAt),
				gte(job.startsAt, now),
				lt(job.startsAt, weekOut),
				sql`${job.status} not in ('cancelled')`
			)
		)
		.where(eq(member.organizationId, orgId))
		.groupBy(member.id, user.name)
		.orderBy(desc(minutes));
	const capacity = 7 * 8 * 60;
	return rows.map((r) => ({
		name: r.name,
		hours: Math.round((r.minutes / 60) * 10) / 10,
		pct: Math.min(999, Math.round((r.minutes / capacity) * 100))
	}));
}

/** Per-technician performance over the last 90 days: completed jobs, logged hours, revenue collected on their jobs. */
async function techPerformance(orgId: string) {
	const since = new Date(Date.now() - 90 * 86400_000);
	const [done, hours, revenue] = await Promise.all([
		db
			.select({
				memberId: job.technicianId,
				jobs: sql<number>`count(*)`.mapWith(Number),
				avgRating: sql<number>`avg(${job.rating})`.mapWith(Number)
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
				.select({ memberId: member.id, name: user.name, pct: member.commissionPct })
				.from(member)
				.innerJoin(user, eq(member.userId, user.id))
				.where(eq(member.organizationId, orgId))
		).map((r) => [r.memberId, r])
	);
	const doneMap = new Map(done.map((r) => [r.memberId, r]));
	const hoursMap = new Map(hours.map((r) => [r.memberId, r.minutes]));
	const revMap = new Map(revenue.map((r) => [r.memberId, r.total]));
	return [...ids]
		.map((memberId) => {
			const info = names.get(memberId);
			const revenue = revMap.get(memberId) ?? 0;
			const pct = info?.pct ?? 0;
			return {
				memberId,
				name: info?.name ?? 'Former staff',
				jobsDone: doneMap.get(memberId)?.jobs ?? 0,
				avgRating: doneMap.get(memberId)?.avgRating ?? null,
				minutes: hoursMap.get(memberId) ?? 0,
				// Logged labor per completed job — a rough "efficiency" read.
				avgMinPerJob:
					Math.round(((hoursMap.get(memberId) ?? 0) / (doneMap.get(memberId)?.jobs || 1)) * 10) /
					10,
				revenue,
				commissionPct: pct,
				commission: Math.round((revenue * pct) / 100)
			};
		})
		.sort((a, b) => b.revenue - a.revenue || b.jobsDone - a.jobsDone);
}

async function avgDaysToPay(orgId: string) {
	// Average days issued→fully-paid for invoices settled in the last 90d.
	const rows = await db
		.select({
			issuedAt: invoice.issuedAt,
			lastPaid: sql<string>`(select max(p.paid_at) from ${payment} p join ${charge} c on p.charge_id = c.id where c.invoice_id = ${outer(invoice.id)})`,
			covered:
				sql<boolean>`coalesce((select sum(p.amount) from ${payment} p join ${charge} c on p.charge_id = c.id where c.invoice_id = ${outer(invoice.id)}), 0) >= coalesce((select sum(it.qty * it.unit_price) from ${invoiceItem} it where it.invoice_id = ${outer(invoice.id)}), 0)`.mapWith(
					Boolean
				)
		})
		.from(invoice)
		.where(
			and(
				eq(invoice.organizationId, orgId),
				gte(invoice.issuedAt, new Date(Date.now() - 90 * 86400_000))
			)
		);
	const settled = rows.filter((r) => r.covered && r.lastPaid);
	if (!settled.length) return { n: 0, avgDays: 0 };
	const total = settled.reduce(
		(sum, r) =>
			sum + Math.max(0, (new Date(r.lastPaid!).getTime() - r.issuedAt.getTime()) / 86400_000),
		0
	);
	return { n: settled.length, avgDays: Math.round(total / settled.length) };
}

async function completionStats(orgId: string) {
	const [row] = await db
		.select({
			done: sql<number>`count(*) filter (where ${job.status} = 'done')`.mapWith(Number),
			cancelled:
				sql<number>`count(*) filter (where ${job.status} = 'cancelled' or ${job.cancelledAt} is not null)`.mapWith(
					Number
				),
			total: sql<number>`count(*)`.mapWith(Number),
			noShow:
				sql<number>`count(*) filter (where ${job.status} = 'cancelled' and ${job.cancelReason} is not null and ${job.cancelReason} ilike '%no%show%')`.mapWith(
					Number
				)
		})
		.from(job)
		.where(
			and(eq(job.organizationId, orgId), gte(job.createdAt, new Date(Date.now() - 90 * 86400_000)))
		);
	// Avg scheduled→completed span for jobs done in the window.
	const [span] = await db
		.select({
			n: sql<number>`count(*)`.mapWith(Number),
			avgDays:
				sql<number>`avg(extract(epoch from (${job.completedAt} - ${job.startsAt})) / 86400.0)`.mapWith(
					Number
				)
		})
		.from(job)
		.where(
			and(
				eq(job.organizationId, orgId),
				eq(job.status, 'done'),
				isNotNull(job.completedAt),
				isNotNull(job.startsAt),
				gte(job.completedAt, new Date(Date.now() - 90 * 86400_000))
			)
		);
	return { ...row, avgDaysToComplete: span?.n ? span.avgDays : null };
}

/** Materials burned in the last 90 days — the restock list. */
async function topMaterials(orgId: string) {
	return db
		.select({
			name: inventoryItem.name,
			unit: inventoryItem.unit,
			qty: sql<number>`sum(${jobMaterial.qty})`.mapWith(Number),
			jobs: sql<number>`count(distinct ${jobMaterial.jobId})`.mapWith(Number)
		})
		.from(jobMaterial)
		.innerJoin(inventoryItem, eq(jobMaterial.inventoryItemId, inventoryItem.id))
		.where(
			and(
				eq(jobMaterial.organizationId, orgId),
				gte(jobMaterial.createdAt, new Date(Date.now() - 90 * 86400_000))
			)
		)
		.groupBy(inventoryItem.id, inventoryItem.name, inventoryItem.unit)
		.orderBy(desc(sql`sum(${jobMaterial.qty})`))
		.limit(8);
}

/** Average days from job completion to invoice issuance (invoices linked to jobs, last 90d). */
async function avgDaysToInvoice(orgId: string) {
	const [row] = await db
		.select({
			n: sql<number>`count(*)`.mapWith(Number),
			avg: sql<number>`avg(extract(epoch from (${invoice.issuedAt} - ${job.completedAt})) / 86400.0)`.mapWith(
				Number
			)
		})
		.from(invoice)
		.innerJoin(job, eq(invoice.jobId, job.id))
		.where(
			and(
				eq(invoice.organizationId, orgId),
				ne(invoice.status, 'void'),
				isNotNull(job.completedAt),
				gte(invoice.issuedAt, new Date(Date.now() - 90 * 86400_000))
			)
		);
	return row?.n ? row.avg : null;
}

/** Revenue collected in the last 90 days grouped by customer type. */
async function revenueByCustomerType(orgId: string) {
	return db
		.select({
			type: customer.type,
			n: sql<number>`count(distinct ${customer.id})`.mapWith(Number),
			total: sql<number>`coalesce(sum(${payment.amount}), 0)`.mapWith(Number)
		})
		.from(payment)
		.innerJoin(customer, eq(payment.customerId, customer.id))
		.where(
			and(
				eq(payment.organizationId, orgId),
				gte(payment.paidAt, new Date(Date.now() - 90 * 86400_000))
			)
		)
		.groupBy(customer.type)
		.orderBy(desc(sql`sum(${payment.amount})`));
}

/** Warranty visits completed in the last 90d plus the labor logged on warranty jobs. */
async function warrantyWork(orgId: string) {
	const since = new Date(Date.now() - 90 * 86400_000);
	const [jobs] = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(job)
		.where(
			and(
				eq(job.organizationId, orgId),
				eq(job.warranty, true),
				eq(job.status, 'done'),
				gte(job.completedAt, since)
			)
		);
	const [mins] = await db
		.select({
			m: sql<number>`coalesce(sum(extract(epoch from (${jobTimeEntry.endedAt} - ${jobTimeEntry.startedAt})) / 60 - coalesce(${jobTimeEntry.breakMin}, 0)), 0)`.mapWith(
				Number
			)
		})
		.from(jobTimeEntry)
		.innerJoin(job, eq(jobTimeEntry.jobId, job.id))
		.where(
			and(
				eq(job.organizationId, orgId),
				eq(job.warranty, true),
				isNotNull(jobTimeEntry.endedAt),
				gte(jobTimeEntry.startedAt, since)
			)
		);
	return { count: jobs?.n ?? 0, minutes: Math.max(0, Math.round(mins?.m ?? 0)) };
}

/** Collected payments per service ZIP (last 90 days) — territory view for scheduling/marketing. */
async function revenueByZip(orgId: string) {
	return db
		.select({
			zip: serviceLocation.zip,
			n: sql<number>`count(*)`.mapWith(Number),
			total: sql<number>`coalesce(sum(${payment.amount}), 0)`.mapWith(Number)
		})
		.from(payment)
		.innerJoin(charge, eq(payment.chargeId, charge.id))
		.innerJoin(invoice, eq(charge.invoiceId, invoice.id))
		.innerJoin(job, eq(invoice.jobId, job.id))
		.innerJoin(serviceLocation, eq(job.serviceLocationId, serviceLocation.id))
		.where(
			and(
				eq(payment.organizationId, orgId),
				gte(payment.paidAt, new Date(Date.now() - 90 * 86400_000))
			)
		)
		.groupBy(serviceLocation.zip)
		.orderBy(desc(sql`sum(${payment.amount})`))
		.limit(10);
}

/** Agreements cancelled over the last 90 days (churn signal). */
async function churnedAgreements(orgId: string) {
	const [row] = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(serviceAgreement)
		.where(
			and(
				eq(serviceAgreement.organizationId, orgId),
				eq(serviceAgreement.status, 'cancelled'),
				gte(serviceAgreement.updatedAt, new Date(Date.now() - 90 * 86400_000))
			)
		);
	return row?.n ?? 0;
}

/** Refunds issued over the last 90 days (negative payments). */
async function refundsTotal(orgId: string) {
	const [row] = await db
		.select({
			n: sql<number>`count(*)`.mapWith(Number),
			total: sql<number>`coalesce(sum(${payment.amount}), 0)`.mapWith(Number)
		})
		.from(payment)
		.where(
			and(
				eq(payment.organizationId, orgId),
				lt(payment.amount, 0),
				gte(payment.paidAt, new Date(Date.now() - 90 * 86400_000))
			)
		);
	return row?.n ? row.total : 0;
}

/** Customer tips collected online in the last 30 days ('Tip —' other-charges from checkout). */
async function tipsCollected(orgId: string) {
	const [row] = await db
		.select({
			n: sql<number>`count(*)`.mapWith(Number),
			total: sql<number>`coalesce(sum(${payment.amount}), 0)`.mapWith(Number)
		})
		.from(payment)
		.innerJoin(charge, eq(payment.chargeId, charge.id))
		.where(
			and(
				eq(payment.organizationId, orgId),
				eq(charge.kind, 'other'),
				sql`${charge.description} like 'Tip —%'`,
				gte(payment.paidAt, new Date(Date.now() - 30 * 86400_000))
			)
		);
	return row ?? { n: 0, total: 0 };
}

/** Spend committed on open purchase orders (draft + ordered). */
async function openPOValue(orgId: string) {
	const [row] = await db
		.select({
			pos: sql<number>`count(distinct ${purchaseOrder.id})`.mapWith(Number),
			total:
				sql<number>`coalesce(sum(${purchaseOrderItem.qty} * ${purchaseOrderItem.unitCost}), 0)`.mapWith(
					Number
				)
		})
		.from(purchaseOrderItem)
		.innerJoin(purchaseOrder, eq(purchaseOrderItem.purchaseOrderId, purchaseOrder.id))
		.where(
			and(
				eq(purchaseOrder.organizationId, orgId),
				inArray(purchaseOrder.status, ['draft', 'ordered'])
			)
		);
	return row ?? { pos: 0, total: 0 };
}

/** Average issued-invoice total over the last 90 days. */
async function avgTicket(orgId: string) {
	const [row] = await db
		.select({
			n: sql<number>`count(*)`.mapWith(Number),
			avg: sql<number>`avg((select coalesce(sum(c.amount), 0) from ${charge} c where c.invoice_id = ${outer(invoice.id)} and c.status != 'void'))`.mapWith(
				Number
			)
		})
		.from(invoice)
		.where(
			and(
				eq(invoice.organizationId, orgId),
				eq(invoice.status, 'open'),
				gte(invoice.issuedAt, new Date(Date.now() - 90 * 86400_000))
			)
		);
	return row?.n ? row.avg : null;
}

/** Estimate accuracy: invoiced total vs the quoted total for converted estimates. */
async function estimateAccuracy(orgId: string) {
	const conv = await db
		.select({
			id: estimate.id,
			jobId: estimate.jobId,
			total:
				sql<number>`coalesce((select sum(i.qty * i.unit_price) from ${estimateItem} i where i.estimate_id = ${outer(estimate.id)} and i.optional = false), 0)`.mapWith(
					Number
				)
		})
		.from(estimate)
		.where(
			and(
				eq(estimate.organizationId, orgId),
				eq(estimate.status, 'converted'),
				isNotNull(estimate.jobId)
			)
		);
	if (!conv.length) return { count: 0, avgVariancePct: null };
	const jobIds = conv.map((e) => e.jobId!).filter(Boolean);
	const invoiced = await db
		.select({
			jobId: charge.jobId,
			total: sql<number>`coalesce(sum(${charge.amount}), 0)`.mapWith(Number)
		})
		.from(charge)
		.where(
			and(
				eq(charge.organizationId, orgId),
				inArray(charge.jobId, jobIds),
				sql`${charge.amount} > 0`,
				sql`${charge.status} != 'void'`
			)
		)
		.groupBy(charge.jobId);
	const byJob = new Map(invoiced.map((r) => [r.jobId, r.total]));
	const variances = conv
		.filter((e) => e.total > 0)
		.map((e) => ((byJob.get(e.jobId!) ?? 0) - e.total) / e.total);
	if (!variances.length) return { count: conv.length, avgVariancePct: null };
	const avg = variances.reduce((a, b) => a + b, 0) / variances.length;
	return { count: variances.length, avgVariancePct: Math.round(avg * 100) };
}

/** Declined estimates grouped by decline reason — count + quoted value lost. */
async function lostByReason(orgId: string) {
	return db
		.select({
			reason: sql<string>`coalesce(nullif(${estimate.declineReason}, ''), 'unspecified')`,
			count: sql<number>`count(*)`.mapWith(Number),
			total:
				sql<number>`coalesce(sum((select sum(i.qty * i.unit_price) from estimate_item i where i.estimate_id = ${outer(estimate.id)})), 0)`.mapWith(
					Number
				)
		})
		.from(estimate)
		.where(and(eq(estimate.organizationId, orgId), eq(estimate.status, 'declined')))
		.groupBy(sql`coalesce(nullif(${estimate.declineReason}, ''), 'unspecified')`)
		.orderBy(desc(sql`count(*)`));
}

export async function getReports(orgId: string) {
	const [
		completedJobs,
		customers,
		revenue,
		plans,
		byType,
		estimates,
		techs,
		labor,
		util,
		variance,
		perf,
		profit,
		tops,
		leads,
		aging,
		offices,
		salesByType,
		payMethodRows,
		jobSourceRows,
		completion,
		daysToPay,
		topMaterialRows,
		ticket,
		daysToInvoice,
		openPOs,
		refunds,
		tips,
		churned,
		revByType,
		decisionDays,
		repeat,
		jobValue,
		jobMin,
		cancel,
		avgItems,
		expenses90d,
		matMargin,
		ratings,
		estAccuracy,
		callbacks,
		revWeekday,
		lost,
		zipRows,
		warranty
	] = await Promise.all([
		jobsByDay(orgId),
		newCustomersByMonth(orgId),
		revenueByMonth(orgId),
		agreementsByPlan(orgId),
		jobsByType(orgId),
		estimateFunnel(orgId),
		technicianLoad(orgId),
		laborByTechnician(orgId),
		utilization(orgId),
		timesheetVariance(orgId),
		techPerformance(orgId),
		jobProfitability(orgId),
		topCustomers(orgId),
		leadsBySource(orgId),
		receivablesAging(orgId),
		officePerformance(orgId),
		salesByJobType(orgId),
		paymentsByMethod(orgId),
		jobsBySource(orgId),
		completionStats(orgId),
		avgDaysToPay(orgId),
		topMaterials(orgId),
		avgTicket(orgId),
		avgDaysToInvoice(orgId),
		openPOValue(orgId),
		refundsTotal(orgId),
		tipsCollected(orgId),
		churnedAgreements(orgId),
		revenueByCustomerType(orgId),
		avgDaysToEstimateDecision(orgId),
		repeatRate(orgId),
		avgJobValue(orgId),
		avgJobMinutes(orgId),
		cancelRate(orgId),
		avgItemsPerEstimate(orgId),
		expenseTotal(orgId),
		materialsMargin(orgId),
		visitRatings(orgId),
		estimateAccuracy(orgId),
		callbackRate(orgId),
		revenueByWeekday(orgId),
		lostByReason(orgId),
		revenueByZip(orgId),
		warrantyWork(orgId)
	]);
	return {
		completedJobs,
		customers,
		revenue,
		plans,
		byType,
		estimates,
		techs,
		labor,
		utilization: util,
		variance,
		perf,
		profit,
		topCustomers: tops,
		leads,
		aging,
		offices,
		salesByType,
		payMethods: payMethodRows,
		jobSources: jobSourceRows,
		completion,
		daysToPay,
		topMaterials: topMaterialRows,
		avgTicket: ticket,
		avgDaysToInvoice: daysToInvoice,
		openPOs,
		refunds,
		tips,
		churnedAgreements: churned,
		revByCustomerType: revByType,
		estimateDecisionDays: decisionDays,
		repeatRate: repeat,
		avgJobValue: jobValue,
		avgJobMinutes: jobMin,
		cancelRate: cancel,
		avgItemsPerQuote: avgItems,
		expenses90d,
		materialsMargin: matMargin,
		ratings,
		estAccuracy,
		callbacks,
		revWeekday,
		lostByReason: lost,
		revByZip: zipRows,
		warranty
	};
}

/** Portal visit ratings — average + count over the last 90 days. */
async function visitRatings(orgId: string) {
	const [r] = await db
		.select({
			avg: sql<number>`avg(${job.rating})`.mapWith(Number),
			n: sql<number>`count(*)`.mapWith(Number),
			low: sql<number>`count(*) filter (where ${job.rating} <= 3)`.mapWith(Number)
		})
		.from(job)
		.where(
			and(
				eq(job.organizationId, orgId),
				eq(job.status, 'done'),
				gte(job.ratedAt, new Date(Date.now() - 90 * 86400_000))
			)
		);
	return { avg: r?.avg ?? null, n: r?.n ?? 0, low: r?.low ?? 0 };
}

/** Completed jobs + collected revenue grouped by job type (all time). */
async function salesByJobType(orgId: string) {
	const done = await db
		.select({
			type: sql<string>`coalesce(${jobType.name}, 'Unclassified')`,
			count: sql<number>`count(*)`.mapWith(Number)
		})
		.from(job)
		.leftJoin(jobType, eq(job.jobTypeId, jobType.id))
		.where(and(eq(job.organizationId, orgId), eq(job.status, 'done'), isNull(job.cancelledAt)))
		.groupBy(sql`coalesce(${jobType.name}, 'Unclassified')`);
	const collected = await db
		.select({
			type: sql<string>`coalesce(${jobType.name}, 'Unclassified')`,
			total: sql<number>`sum(${payment.amount})`.mapWith(Number)
		})
		.from(payment)
		.innerJoin(charge, eq(payment.chargeId, charge.id))
		.innerJoin(job, eq(charge.jobId, job.id))
		.leftJoin(jobType, eq(job.jobTypeId, jobType.id))
		.where(eq(payment.organizationId, orgId))
		.groupBy(sql`coalesce(${jobType.name}, 'Unclassified')`);
	const map = new Map(collected.map((r) => [r.type, r.total]));
	return done
		.map((r) => ({ type: r.type, jobs: r.count, collected: map.get(r.type) ?? 0 }))
		.sort((a, b) => b.collected - a.collected || b.jobs - a.jobs);
}

/** Job counts + completed-job revenue grouped by origin (all time). */
async function jobsBySource(orgId: string) {
	const rows = await db
		.select({
			source: job.source,
			count: sql<number>`count(*)`.mapWith(Number),
			done: sql<number>`count(*) filter (where ${job.status} = 'done')`.mapWith(Number)
		})
		.from(job)
		.where(and(eq(job.organizationId, orgId), isNull(job.cancelledAt)))
		.groupBy(job.source);
	return rows.sort((a, b) => b.count - a.count);
}

/** Customers + collected revenue grouped by lead source (all time). */
async function leadsBySource(orgId: string) {
	const customers_ = await db
		.select({
			source: sql<string>`coalesce(nullif(${customer.leadSource}, ''), 'Unknown')`,
			count: sql<number>`count(*)`.mapWith(Number)
		})
		.from(customer)
		.where(eq(customer.organizationId, orgId))
		.groupBy(sql`coalesce(nullif(${customer.leadSource}, ''), 'Unknown')`);
	const collected = await db
		.select({
			source: sql<string>`coalesce(nullif(${customer.leadSource}, ''), 'Unknown')`,
			total: sql<number>`sum(${payment.amount})`.mapWith(Number)
		})
		.from(payment)
		.innerJoin(customer, eq(payment.customerId, customer.id))
		.where(eq(payment.organizationId, orgId))
		.groupBy(sql`coalesce(nullif(${customer.leadSource}, ''), 'Unknown')`);
	const map = new Map(collected.map((r) => [r.source, r.total]));
	return customers_
		.map((r) => ({ source: r.source, customers: r.count, collected: map.get(r.source) ?? 0 }))
		.sort((a, b) => b.collected - a.collected || b.customers - a.customers);
}

/** Done jobs in the last 90d: invoiced total vs materials cost + labor hours. */
async function jobProfitability(orgId: string) {
	const since = new Date(Date.now() - 90 * 86400_000);
	return db
		.select({
			id: job.id,
			number: job.number,
			summary: job.summary,
			customerName: customer.name,
			completedAt: job.completedAt,
			billed:
				sql<number>`(select coalesce(sum(c.amount), 0) from ${charge} c where c.job_id = ${outer(job.id)} and c.status != 'void')`.mapWith(
					Number
				),
			matCost:
				sql<number>`(select coalesce(sum(m.qty * i.unit_cost), 0) from ${jobMaterial} m inner join ${inventoryItem} i on m.inventory_item_id = i.id where m.job_id = ${outer(job.id)})`.mapWith(
					Number
				),
			expCost:
				sql<number>`(select coalesce(sum(e.amount), 0) from ${jobExpense} e where e.job_id = ${outer(job.id)})`.mapWith(
					Number
				),
			laborCost:
				sql<number>`(select coalesce(round(sum(extract(epoch from (coalesce(te.ended_at, now()) - te.started_at)) / 3600.0 * m.labor_cost_cents)), 0) from ${jobTimeEntry} te join ${member} m on m.id = te.member_id where te.job_id = ${outer(job.id)})`.mapWith(
					Number
				),
			laborMin:
				sql<number>`(select coalesce(sum(extract(epoch from (coalesce(te.ended_at, now()) - te.started_at)) / 60), 0) from ${jobTimeEntry} te where te.job_id = ${outer(job.id)})`.mapWith(
					Number
				),
			schedMin:
				sql<number>`coalesce(round(extract(epoch from (${job.endsAt} - ${job.startsAt}))::numeric / 60), 0)`.mapWith(
					Number
				)
		})
		.from(job)
		.innerJoin(customer, eq(job.customerId, customer.id))
		.where(and(eq(job.organizationId, orgId), isNull(job.cancelledAt), gte(job.completedAt, since)))
		.orderBy(desc(job.completedAt));
}

/** Materials billed vs inventory cost over the last 90 days. */
async function materialsMargin(orgId: string) {
	const [row] = await db
		.select({
			sell: sql<number>`coalesce(sum(${jobMaterial.qty} * ${jobMaterial.unitPrice}), 0)`.mapWith(
				Number
			),
			cost: sql<number>`coalesce(sum(${jobMaterial.qty} * ${inventoryItem.unitCost}), 0)`.mapWith(
				Number
			)
		})
		.from(jobMaterial)
		.innerJoin(inventoryItem, eq(jobMaterial.inventoryItemId, inventoryItem.id))
		.where(
			and(
				eq(jobMaterial.organizationId, orgId),
				gte(jobMaterial.createdAt, new Date(Date.now() - 90 * 86400_000))
			)
		);
	return row.sell || row.cost ? { sell: row.sell, cost: row.cost } : null;
}

/** Total job expenses logged in the last 90 days. */
async function expenseTotal(orgId: string) {
	const [{ v }] = await db
		.select({ v: sql<number>`coalesce(sum(${jobExpense.amount}), 0)`.mapWith(Number) })
		.from(jobExpense)
		.where(
			and(
				eq(jobExpense.organizationId, orgId),
				gte(jobExpense.createdAt, new Date(Date.now() - 90 * 86400_000))
			)
		);
	return v;
}

/** Open charge balances bucketed by days past due (or not yet due). */
async function receivablesAging(orgId: string) {
	const rows = await db
		.select({
			bucket: sql<string>`case
				when ${charge.dueDate} is null or ${charge.dueDate} >= current_date then 'current'
				when ${charge.dueDate} >= current_date - 30 then '1-30'
				when ${charge.dueDate} >= current_date - 60 then '31-60'
				when ${charge.dueDate} >= current_date - 90 then '61-90'
				else '90+'
			end`,
			balance:
				sql<number>`sum(${charge.amount} - coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${outer(charge.id)}), 0))`.mapWith(
					Number
				),
			count:
				sql<number>`count(*) filter (where ${charge.amount} - coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${outer(charge.id)}), 0) > 0)`.mapWith(
					Number
				)
		})
		.from(charge)
		.where(and(eq(charge.organizationId, orgId), sql`${charge.status} != 'void'`))
		.groupBy(
			sql`case
				when ${charge.dueDate} is null or ${charge.dueDate} >= current_date then 'current'
				when ${charge.dueDate} >= current_date - 30 then '1-30'
				when ${charge.dueDate} >= current_date - 60 then '31-60'
				when ${charge.dueDate} >= current_date - 90 then '61-90'
				else '90+'
			end`
		);
	const map = new Map(rows.map((r) => [r.bucket, r]));
	return ['current', '1-30', '31-60', '61-90', '90+'].map((bucket) => ({
		bucket,
		balance: map.get(bucket)?.balance ?? 0,
		count: map.get(bucket)?.count ?? 0
	}));
}

/** Top 10 customers by payments collected in the last 12 months. */
async function topCustomers(orgId: string) {
	const since = new Date(Date.now() - 365 * 86400_000);
	return db
		.select({
			id: customer.id,
			name: customer.name,
			collected: sql<number>`sum(${payment.amount})`.mapWith(Number)
		})
		.from(payment)
		.innerJoin(customer, eq(payment.customerId, customer.id))
		.where(and(eq(payment.organizationId, orgId), gte(payment.paidAt, since)))
		.groupBy(customer.id, customer.name)
		.orderBy(desc(sql`sum(${payment.amount})`))
		.limit(10);
}

/** Jobs + collected revenue per office (all time); offices with none still listed. */
async function officePerformance(orgId: string) {
	const offices = await db
		.select()
		.from(office)
		.where(eq(office.organizationId, orgId))
		.orderBy(asc(office.name));
	const jobs = await db
		.select({
			officeId: job.officeId,
			total: sql<number>`count(*)`.mapWith(Number),
			done: sql<number>`count(*) filter (where ${job.status} = 'done')`.mapWith(Number)
		})
		.from(job)
		.where(and(eq(job.organizationId, orgId), isNull(job.cancelledAt)))
		.groupBy(job.officeId);
	const collected = await db
		.select({
			officeId: job.officeId,
			total: sql<number>`sum(${payment.amount})`.mapWith(Number)
		})
		.from(payment)
		.innerJoin(charge, eq(payment.chargeId, charge.id))
		.innerJoin(job, eq(charge.jobId, job.id))
		.where(eq(payment.organizationId, orgId))
		.groupBy(job.officeId);
	const jobsMap = new Map(jobs.map((r) => [r.officeId ?? '', r]));
	const revMap = new Map(collected.map((r) => [r.officeId ?? '', r.total]));
	const names = new Map(offices.map((o) => [o.id, o.name]));
	const ids = new Set([...jobsMap.keys(), ...names.keys(), ...revMap.keys()]);
	return [...ids]
		.filter((id) => id !== undefined)
		.map((id) => ({
			id: (id ?? '') as string,
			name: id ? (names.get(id) ?? 'Former office') : 'Unassigned',
			jobs: jobsMap.get(id as string)?.total ?? 0,
			done: jobsMap.get(id as string)?.done ?? 0,
			revenue: revMap.get((id ?? '') as string) ?? 0
		}))
		.sort((a, b) => b.revenue - a.revenue || b.jobs - a.jobs);
}
