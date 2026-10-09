import {
	and,
	asc,
	count,
	desc,
	eq,
	gte,
	inArray,
	isNotNull,
	isNull,
	lt,
	lte,
	ne,
	sql
} from 'drizzle-orm';
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
	memberTimeOff,
	payment,
	pricebookItem,
	purchaseOrder,
	serviceAgreement,
	user,
	outer
} from '#lib/server/db/schema.ts';
import { monthlyRecurring } from './billing.ts';
import { dueFollowUps } from './followups.ts';
import { addDays, localDate, localTime, zonedToUtc } from '#lib/tz.ts';

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

	// Daily collections for the last 7 local days — the KPI card's mini bar chart.
	const payments7 = await db
		.select({
			day: sql<string>`to_char(timezone(${tz}, ${payment.paidAt}), 'YYYY-MM-DD')`,
			total: sql<number>`coalesce(sum(${payment.amount}), 0)`.mapWith(Number)
		})
		.from(payment)
		.where(
			and(
				eq(payment.organizationId, orgId),
				gte(payment.paidAt, new Date(dayStart.getTime() - 6 * 24 * 60 * 60 * 1000)),
				lt(payment.paidAt, dayEnd)
			)
		)
		.groupBy(sql`1`);
	const byDay = new Map(payments7.map((p) => [p.day, p.total]));
	const paymentsWeek = Array.from({ length: 7 }, (_, i) => {
		const d = new Date(Date.parse(today) - (6 - i) * 24 * 60 * 60 * 1000)
			.toISOString()
			.slice(0, 10);
		return { day: d, total: byDay.get(d) ?? 0 };
	});

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

	// Staff licenses expiring within 30 days (or already lapsed) — compliance.
	const expiringLicenses = await db
		.select({ name: user.name, licenseExpiry: member.licenseExpiry })
		.from(member)
		.innerJoin(user, eq(member.userId, user.id))
		.where(
			and(
				eq(member.organizationId, orgId),
				isNotNull(member.licenseExpiry),
				lte(member.licenseExpiry, warrantyHorizon)
			)
		)
		.orderBy(asc(member.licenseExpiry))
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

	// Repeat customers with no active agreement — upsell candidates for a
	// maintenance plan (3+ completed visits in the last 90 days).
	const upsellCustomers = await db
		.select({
			id: customer.id,
			name: customer.name,
			visits: sql<number>`count(*)`.mapWith(Number)
		})
		.from(job)
		.innerJoin(customer, eq(job.customerId, customer.id))
		.where(
			and(
				eq(job.organizationId, orgId),
				eq(job.status, 'done'),
				gte(job.completedAt, cutoff),
				sql`not exists (select 1 from ${serviceAgreement} sa where sa.customer_id = ${customer.id} and sa.status = 'active')`
			)
		)
		.groupBy(customer.id, customer.name)
		.having(sql`count(*) >= 3`)
		.orderBy(desc(sql`count(*)`))
		.limit(3);

	const [pendingTimeOff] = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(memberTimeOff)
		.where(and(eq(memberTimeOff.organizationId, orgId), eq(memberTimeOff.status, 'pending')));

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

	const unapprovedTime = await db
		.select({ count: sql<number>`count(*)`.mapWith(Number) })
		.from(jobTimeEntry)
		.where(
			and(
				eq(jobTimeEntry.organizationId, orgId),
				isNull(jobTimeEntry.approvedAt),
				isNotNull(jobTimeEntry.endedAt),
				gte(jobTimeEntry.startedAt, new Date(Date.now() - 30 * 86400_000))
			)
		)
		.then((r) => r[0]?.count ?? 0);

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

	const [unpaidPo] = await db
		.select({
			n: count(),
			total:
				sql<number>`coalesce(sum((select sum(i.qty * i.unit_cost) from purchase_order_item i where i.purchase_order_id = ${purchaseOrder.id})), 0)`.mapWith(
					Number
				)
		})
		.from(purchaseOrder)
		.where(
			and(
				eq(purchaseOrder.organizationId, orgId),
				inArray(purchaseOrder.status, ['ordered', 'received']),
				isNull(purchaseOrder.paidAt)
			)
		);

	const [typeCount, itemCount, memberCount] = await Promise.all([
		db.select({ n: count() }).from(jobType).where(eq(jobType.organizationId, orgId)),
		db.select({ n: count() }).from(pricebookItem).where(eq(pricebookItem.organizationId, orgId)),
		db.select({ n: count() }).from(member).where(eq(member.organizationId, orgId))
	]);
	const monthStart = zonedToUtc(`${today.slice(0, 8)}01T00:00`, tz);
	const leaderboard = await db
		.select({
			name: user.name,
			done: sql<number>`count(*)`.mapWith(Number),
			hours:
				sql<number>`coalesce((select round(coalesce(sum(extract(epoch from (coalesce(te.ended_at, now()) - te.started_at)) / 3600.0), 0)::numeric, 1) from ${jobTimeEntry} te where te.member_id = ${outer(member.id)} and te.started_at >= ${monthStart.toISOString()}), 0)`.mapWith(
					Number
				)
		})
		.from(job)
		.innerJoin(member, eq(job.technicianId, member.id))
		.innerJoin(user, eq(member.userId, user.id))
		.where(
			and(eq(job.organizationId, orgId), eq(job.status, 'done'), gte(job.completedAt, monthStart))
		)
		.groupBy(user.name, member.id)
		.orderBy(desc(sql`count(*)`))
		.limit(5);

	// Nothing on tomorrow's board while work sits in the queue.
	const tomorrowStart = zonedToUtc(`${addDays(today, 1)}T00:00`, tz);
	const dayAfterStart = zonedToUtc(`${addDays(today, 2)}T00:00`, tz);
	const [tomorrowJobs] = await db
		.select({ n: count() })
		.from(job)
		.where(
			and(
				eq(job.organizationId, orgId),
				isNull(job.cancelledAt),
				ne(job.status, 'done'),
				ne(job.status, 'cancelled'),
				gte(job.startsAt, tomorrowStart),
				lt(job.startsAt, dayAfterStart)
			)
		);

	const setup = {
		types: (typeCount[0]?.n ?? 0) > 0,
		catalog: (itemCount[0]?.n ?? 0) > 0,
		customers: (customerStats?.active ?? 0) > 0,
		team: (memberCount[0]?.n ?? 0) > 1,
		booking: !!settings?.bookingEnabled && !!settings?.publicPage
	};

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
		paymentsWeek,
		activeAgreements: agreementStats?.active ?? 0,
		openTotal: openStats?.openTotal ?? 0,
		overdueTotal: openStats?.overdueTotal ?? 0,
		mrr,
		setup,
		leaderboard,
		todayJobs,
		recentActivity,
		recentCustomers,
		attention: [
			...(tomorrowJobs.n === 0 && (jobStats?.unscheduled ?? 0) > 0
				? [
						{
							tone: 'amber' as const,
							href: '/dispatch',
							text: "Tomorrow's board is empty",
							sub: `${jobStats?.unscheduled ?? 0} job${jobStats?.unscheduled === 1 ? '' : 's'} waiting in the queue`,
							amountCents: null as number | null
						}
					]
				: []),
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
			...expiringLicenses.map((l) => ({
				tone: (l.licenseExpiry! < today ? 'red' : 'amber') as 'red' | 'amber',
				href: '/settings?tab=team',
				text: `${l.name} · license ${l.licenseExpiry! < today ? 'expired' : 'expires'} ${l.licenseExpiry}`,
				sub: 'update in Settings → Team',
				amountCents: null as number | null
			})),
			...(unapprovedTime > 0
				? [
						{
							tone: 'amber' as const,
							href: '/payroll',
							text: `${unapprovedTime} time entr${unapprovedTime === 1 ? 'y' : 'ies'} awaiting approval`,
							sub: 'finished entries not yet approved for payroll',
							amountCents: null as number | null
						}
					]
				: []),
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
			...upsellCustomers.map((u) => ({
				tone: 'blue' as const,
				href: `/customers/${u.id}`,
				text: `${u.name} — ${u.visits} visits in 90d`,
				sub: 'no maintenance agreement — suggest one?',
				amountCents: null as number | null
			})),
			...(pendingTimeOff?.n
				? [
						{
							tone: 'amber' as const,
							href: '/settings',
							text: `${pendingTimeOff.n} time-off request${pendingTimeOff.n === 1 ? '' : 's'} awaiting approval`,
							sub: 'review in Settings → Team',
							amountCents: null as number | null
						}
					]
				: []),
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
			...(unpaidPo?.n
				? [
						{
							tone: 'amber' as const,
							href: '/inventory',
							text: `${unpaidPo.n} supplier bill${unpaidPo.n === 1 ? '' : 's'} unpaid`,
							sub: 'mark paid on the purchase order',
							amountCents: unpaidPo.total as number | null
						}
					]
				: []),
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
