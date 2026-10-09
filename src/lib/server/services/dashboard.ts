import { and, asc, desc, eq, gte, isNull, lt, lte, ne, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	activity,
	agreementPlan,
	charge,
	companySettings,
	customer,
	equipment,
	estimate,
	inventoryItem,
	invoice,
	job,
	jobType,
	jobTimeEntry,
	member,
	payment,
	purchaseOrder,
	serviceAgreement,
	user,
	outer
} from '#lib/server/db/schema.ts';
import { monthlyRecurring } from './billing.ts';
import { dueFollowUps } from './followups.ts';
import { localDate, localTime, zonedToUtc } from '#lib/tz.ts';

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

	const [todayPayments] = await db
		.select({
			total: sql<number>`coalesce(sum(${outer(payment.amount)}), 0)`.mapWith(Number)
		})
		.from(payment)
		.where(
			and(
				eq(payment.organizationId, orgId),
				gte(payment.paidAt, dayStart),
				lt(payment.paidAt, dayEnd)
			)
		);

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

	// "Needs attention": open receivables past due, sent estimates gone quiet,
	// equipment warranties ending within a month, agreements billing within two weeks.
	const weekAgo = new Date(Date.now() - 7 * 86400_000);
	const twoWeeksOut = new Date(Date.now() + 14 * 86400_000);
	const warrantyHorizon = `${localDate(new Date(Date.now() + 30 * 86400_000), tz)}`;

	const newBookings7d = await db
		.select({ count: sql<number>`count(*)`.mapWith(Number) })
		.from(job)
		.where(
			and(eq(job.organizationId, orgId), eq(job.source, 'booking'), gte(job.createdAt, weekAgo))
		)
		.then((r) => r[0]?.count ?? 0);

	const overdueCharges = await db
		.select({
			description: charge.description,
			dueDate: charge.dueDate,
			customerName: customer.name,
			invoiceNumber: invoice.number,
			balance:
				sql<number>`${outer(charge.amount)} - coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${outer(charge.id)}), 0)`.mapWith(
					Number
				)
		})
		.from(charge)
		.innerJoin(customer, eq(charge.customerId, customer.id))
		.leftJoin(invoice, eq(charge.invoiceId, invoice.id))
		.where(
			and(eq(charge.organizationId, orgId), eq(charge.status, 'open'), lt(charge.dueDate, today))
		)
		.orderBy(asc(charge.dueDate))
		.limit(4);

	const agingEstimates = await db
		.select({
			number: estimate.number,
			sentAt: estimate.sentAt,
			customerName: customer.name
		})
		.from(estimate)
		.innerJoin(customer, eq(estimate.customerId, customer.id))
		.where(
			and(
				eq(estimate.organizationId, orgId),
				eq(estimate.status, 'sent'),
				lt(estimate.sentAt, weekAgo)
			)
		)
		.orderBy(asc(estimate.sentAt))
		.limit(4);

	// Declined estimates worth a chase: answered over a week ago and never revised.
	const declinedEstimates = await db
		.select({
			number: estimate.number,
			respondedAt: estimate.respondedAt,
			customerName: customer.name
		})
		.from(estimate)
		.innerJoin(customer, eq(estimate.customerId, customer.id))
		.where(
			and(
				eq(estimate.organizationId, orgId),
				eq(estimate.status, 'declined'),
				lt(estimate.respondedAt, weekAgo),
				sql`not exists (select 1 from estimate rev where rev.supersedes_id = ${estimate.id})`
			)
		)
		.orderBy(asc(estimate.respondedAt))
		.limit(4);

	const expiringWarranties = await db
		.select({
			name: equipment.name,
			warrantyUntil: equipment.warrantyUntil,
			customerId: customer.id,
			customerName: customer.name
		})
		.from(equipment)
		.innerJoin(customer, eq(equipment.customerId, customer.id))
		.where(
			and(
				eq(equipment.organizationId, orgId),
				eq(equipment.active, true),
				gte(equipment.warrantyUntil, today),
				lte(equipment.warrantyUntil, warrantyHorizon)
			)
		)
		.orderBy(asc(equipment.warrantyUntil))
		.limit(4);

	const dueService = await db
		.select({
			name: equipment.name,
			nextServiceDue: equipment.nextServiceDue,
			customerId: customer.id,
			customerName: customer.name
		})
		.from(equipment)
		.innerJoin(customer, eq(equipment.customerId, customer.id))
		.where(
			and(
				eq(equipment.organizationId, orgId),
				eq(equipment.active, true),
				lte(equipment.nextServiceDue, today)
			)
		)
		.orderBy(asc(equipment.nextServiceDue))
		.limit(4);

	// Customers whose last completed job is >90 days back with nothing open —
	// prime candidates for a check-in call or a maintenance agreement pitch.
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - 90);
	const quietCustomers = await db
		.select({
			id: customer.id,
			name: customer.name,
			lastAt: sql<string>`max(${job.completedAt})`.mapWith(String)
		})
		.from(customer)
		.innerJoin(
			job,
			and(
				eq(job.customerId, customer.id),
				eq(job.organizationId, orgId),
				eq(job.status, 'done'),
				isNull(job.cancelledAt)
			)
		)
		.where(
			and(
				eq(customer.organizationId, orgId),
				sql`not exists (select 1 from ${job} j2 where j2.customer_id = ${customer.id} and j2.status in ('unscheduled','scheduled','dispatched','in_progress') and j2.cancelled_at is null)`
			)
		)
		.groupBy(customer.id, customer.name)
		.having(sql`max(${job.completedAt}) < ${cutoff.toISOString()}`)
		.orderBy(sql`max(${job.completedAt})`)
		.limit(4);

	const renewingAgreements = await db
		.select({
			nextChargeAt: serviceAgreement.nextChargeAt,
			customerName: customer.name,
			planName: agreementPlan.name,
			amount: agreementPlan.amount
		})
		.from(serviceAgreement)
		.innerJoin(customer, eq(serviceAgreement.customerId, customer.id))
		.innerJoin(agreementPlan, eq(serviceAgreement.planId, agreementPlan.id))
		.where(
			and(
				eq(serviceAgreement.organizationId, orgId),
				eq(serviceAgreement.status, 'active'),
				lte(serviceAgreement.nextChargeAt, twoWeeksOut)
			)
		)
		.orderBy(asc(serviceAgreement.nextChargeAt))
		.limit(4);

	const dueFollowUpRows = await dueFollowUps(orgId, today);

	const blockedJobs = await db
		.select({ id: job.id, number: job.number, summary: job.summary, customerName: customer.name })
		.from(job)
		.innerJoin(customer, eq(job.customerId, customer.id))
		.where(
			and(
				eq(job.organizationId, orgId),
				eq(job.blocked, true),
				isNull(job.cancelledAt),
				ne(job.status, 'done')
			)
		)
		.orderBy(asc(job.number))
		.limit(4);

	const uninvoicedJobs = await db
		.select({ id: job.id, number: job.number, summary: job.summary, customerName: customer.name })
		.from(job)
		.innerJoin(customer, eq(job.customerId, customer.id))
		.where(
			and(
				eq(job.organizationId, orgId),
				eq(job.status, 'done'),
				isNull(job.cancelledAt),
				gte(job.completedAt, new Date(Date.now() - 30 * 86400_000)),
				sql`not exists (select 1 from ${invoice} i where i.job_id = ${outer(job.id)})`
			)
		)
		.orderBy(asc(job.completedAt))
		.limit(4);

	const openClocks = await db
		.select({
			memberName: user.name,
			jobId: job.id,
			jobNumber: job.number,
			customerName: customer.name,
			startedAt: jobTimeEntry.startedAt
		})
		.from(jobTimeEntry)
		.innerJoin(job, eq(jobTimeEntry.jobId, job.id))
		.innerJoin(customer, eq(job.customerId, customer.id))
		.leftJoin(member, eq(jobTimeEntry.memberId, member.id))
		.leftJoin(user, eq(member.userId, user.id))
		.where(and(eq(jobTimeEntry.organizationId, orgId), isNull(jobTimeEntry.endedAt)))
		.orderBy(asc(jobTimeEntry.startedAt))
		.limit(5);

	const lowStock = await db
		.select()
		.from(inventoryItem)
		.where(
			and(
				eq(inventoryItem.organizationId, orgId),
				sql`${inventoryItem.reorderPoint} is not null`,
				sql`${inventoryItem.qtyOnHand} <= ${inventoryItem.reorderPoint}`,
				sql`${inventoryItem.qtyOnHand} > 0`
			)
		)
		.orderBy(asc(inventoryItem.qtyOnHand))
		.limit(4);

	const outOfStock = await db
		.select()
		.from(inventoryItem)
		.where(and(eq(inventoryItem.organizationId, orgId), eq(inventoryItem.qtyOnHand, 0)))
		.orderBy(asc(inventoryItem.name))
		.limit(4);

	// Customers holding unapplied credit (negative open charges) — money the org owes back.
	const creditOnFile = await db
		.select({
			customerId: charge.customerId,
			customerName: customer.name,
			credit: sql<number>`sum(${charge.amount})`.mapWith(Number)
		})
		.from(charge)
		.innerJoin(customer, eq(charge.customerId, customer.id))
		.where(
			and(eq(charge.organizationId, orgId), eq(charge.status, 'open'), sql`${charge.amount} < 0`)
		)
		.groupBy(charge.customerId, customer.name)
		.orderBy(asc(sql`sum(${charge.amount})`))
		.limit(4);

	const staleUnscheduled = await db
		.select({
			id: job.id,
			number: job.number,
			summary: job.summary,
			createdAt: job.createdAt,
			customerName: customer.name
		})
		.from(job)
		.innerJoin(customer, eq(job.customerId, customer.id))
		.where(
			and(
				eq(job.organizationId, orgId),
				eq(job.status, 'unscheduled'),
				isNull(job.cancelledAt),
				lt(job.createdAt, weekAgo)
			)
		)
		.orderBy(asc(job.createdAt))
		.limit(4);

	const latePOs = await db
		.select()
		.from(purchaseOrder)
		.where(
			and(
				eq(purchaseOrder.organizationId, orgId),
				eq(purchaseOrder.status, 'ordered'),
				lt(purchaseOrder.expectedOn, today)
			)
		)
		.orderBy(asc(purchaseOrder.expectedOn))
		.limit(4);

	return {
		timezone: tz,
		currency: settings?.currency ?? 'usd',
		activeCustomers: customerStats?.active ?? 0,
		newThisMonth: customerStats?.newThisMonth ?? 0,
		unscheduledJobs: jobStats?.unscheduled ?? 0,
		inFlightJobs: jobStats?.inFlight ?? 0,
		doneToday: jobStats?.doneToday ?? 0,
		newBookings7d,
		collectedToday: todayPayments?.total ?? 0,
		activeAgreements: agreementStats?.active ?? 0,
		openTotal: openStats?.openTotal ?? 0,
		overdueTotal: openStats?.overdueTotal ?? 0,
		mrr,
		todayJobs,
		recentActivity,
		recentCustomers,
		attention: [
			...dueFollowUpRows.map((f) => ({
				tone: 'amber' as const,
				href: f.jobId
					? `/jobs/${f.jobId}`
					: f.customerId
						? `/customers/${f.customerId}`
						: '/dashboard',
				text: `Follow-up: ${f.note}`,
				sub: `due ${f.dueOn} · ${f.assignee}${f.customerName ? ` · ${f.customerName}` : ''}`,
				amountCents: null as number | null
			})),
			...overdueCharges.map((c) => ({
				tone: 'red' as const,
				href: '/billing',
				text: `${c.customerName} · ${c.description ?? (c.invoiceNumber ? `INV-${c.invoiceNumber}` : 'charge')}`,
				sub: `due ${c.dueDate}`,
				amountCents: c.balance
			})),
			...agingEstimates.map((e) => ({
				tone: 'amber' as const,
				href: '/estimates',
				text: `${e.customerName} · estimate E-${e.number}`,
				sub: `sent ${localDate(e.sentAt!, tz)} — no response yet`,
				amountCents: null as number | null
			})),
			...declinedEstimates.map((e) => ({
				tone: 'amber' as const,
				href: '/estimates',
				text: `${e.customerName} · estimate E-${e.number}`,
				sub: `declined ${localDate(e.respondedAt!, tz)} — worth a follow-up`,
				amountCents: null as number | null
			})),
			...expiringWarranties.map((w) => ({
				tone: 'amber' as const,
				href: `/customers/${w.customerId}`,
				text: `${w.customerName} · ${w.name}`,
				sub: `warranty ends ${w.warrantyUntil}`,
				amountCents: null as number | null
			})),
			...dueService.map((w) => ({
				tone: 'red' as const,
				href: `/customers/${w.customerId}`,
				text: `${w.customerName} · ${w.name}`,
				sub: `service due ${w.nextServiceDue}`,
				amountCents: null as number | null
			})),
			...blockedJobs.map((b) => ({
				tone: 'amber' as const,
				href: `/jobs/${b.id}`,
				text: `${b.customerName} · J-${b.number} ${b.summary}`,
				sub: 'waiting on parts',
				amountCents: null as number | null
			})),
			...uninvoicedJobs.map((j) => ({
				tone: 'amber' as const,
				href: `/jobs/${j.id}`,
				text: `${j.customerName} · J-${j.number} ${j.summary}`,
				sub: 'completed — not invoiced yet',
				amountCents: null as number | null
			})),
			...quietCustomers.map((q) => ({
				tone: 'blue' as const,
				href: `/customers/${q.id}`,
				text: `${q.name} — no visit in 90+ days`,
				sub: `last ${localDate(new Date(q.lastAt), tz)} — reach out?`,
				amountCents: null as number | null
			})),
			...renewingAgreements.map((a) => ({
				tone: 'blue' as const,
				href: '/agreements',
				text: `${a.customerName} · ${a.planName}`,
				sub: `bills ${localDate(a.nextChargeAt!, tz)}`,
				amountCents: a.amount
			})),
			...staleUnscheduled.map((j) => ({
				tone: 'amber' as const,
				href: `/jobs/${j.id}`,
				text: `${j.customerName} · J-${j.number} ${j.summary}`,
				sub: `in the queue since ${localDate(j.createdAt, tz)}`,
				amountCents: null as number | null
			})),
			...latePOs.map((p) => ({
				tone: 'amber' as const,
				href: '/inventory',
				text: `PO-${p.number} · ${p.supplier}`,
				sub: `expected ${p.expectedOn} — still not received`,
				amountCents: null as number | null
			})),
			...outOfStock.map((i) => ({
				tone: 'red' as const,
				href: '/inventory',
				text: `Out of stock · ${i.name}`,
				sub: `${i.sku || 'item'} — none on hand`,
				amountCents: null as number | null
			})),
			...openClocks.map((c) => ({
				tone: 'amber' as const,
				href: `/jobs/${c.jobId}`,
				text: `${c.memberName ?? 'Someone'} still clocked in · J-${c.jobNumber}`,
				sub: `${c.customerName} — since ${localTime(c.startedAt, tz)}`,
				amountCents: null as number | null
			})),
			...creditOnFile.map((c) => ({
				tone: 'amber' as const,
				href: `/customers/${c.customerId}`,
				text: `Credit on file · ${c.customerName}`,
				sub: 'unapplied — apply to an invoice or refund',
				amountCents: c.credit
			})),
			...lowStock.map((i) => ({
				tone: 'amber' as const,
				href: '/inventory',
				text: `Low stock · ${i.name}`,
				sub: `${i.qtyOnHand} ${i.unit} on hand — reorder at ${i.reorderPoint}`,
				amountCents: null as number | null
			}))
		]
	};
}
