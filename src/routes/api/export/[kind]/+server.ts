import { error } from '@sveltejs/kit';
import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { requireOrg } from '#lib/server/context.ts';
import { db } from '#lib/server/db/index.ts';
import {
	customer,
	estimate,
	estimateItem,
	invoice,
	invoiceItem,
	inventoryItem,
	job,
	jobTimeEntry,
	jobType,
	member,
	outer,
	payment,
	pricebookItem,
	charge,
	user
} from '#lib/server/db/schema.ts';
import { alias } from 'drizzle-orm/pg-core';
import { addDays, localDate, localTime, zonedToUtc } from '#lib/tz.ts';
import { exportWorkspace } from '#lib/server/services/backup.ts';
import { getSettings } from '#lib/server/services/settings.ts';
import type { RequestHandler } from './$types';

import { cell } from '#lib/csv.ts';
const row = (cells: unknown[]) =>
	cells
		.map((value) => cell(value == null ? null : typeof value === 'number' ? value : String(value)))
		.join(',');
const money = (cents: number | null | undefined) => (cents == null ? '' : (cents / 100).toFixed(2));

/** CSV exports for staff: `GET /api/export/{invoices,jobs,time-entries,customers,quickbooks,xero}.csv` (optional ?from=&to= YYYY-MM-DD). */
export const GET: RequestHandler = async ({ params, url }) => {
	const ctx = await requireOrg();
	const kind = params.kind?.replace(/\.(csv|json)$/, '');
	const from = url.searchParams.get('from');
	const to = url.searchParams.get('to');
	const badDay = (d: string | null) => d != null && !/^\d{4}-\d{2}-\d{2}$/.test(d);
	if (badDay(from) || badDay(to)) error(400, 'from/to must be YYYY-MM-DD');
	const toBound = to ? `${to}T23:59:59.999Z` : null;
	const filenameDate = new Date().toISOString().slice(0, 10);

	let body: string;
	if (kind === 'invoices') {
		const rows = await db
			.select({
				number: invoice.number,
				customerName: customer.name,
				status: invoice.status,
				issuedAt: invoice.issuedAt,
				dueDate: invoice.dueDate,
				total:
					sql<number>`coalesce((select sum(i.qty * i.unit_price) from ${invoiceItem} i where i.invoice_id = ${outer(invoice.id)}), 0)`.mapWith(
						Number
					),
				paid: sql<number>`coalesce((select sum(p.amount) from ${payment} p inner join ${charge} c on p.charge_id = c.id and p.organization_id = c.organization_id and p.customer_id = c.customer_id where c.invoice_id = ${outer(invoice.id)}), 0)`.mapWith(
					Number
				)
			})
			.from(invoice)
			.innerJoin(
				customer,
				and(
					eq(invoice.customerId, customer.id),
					eq(customer.organizationId, invoice.organizationId)
				)
			)
			.where(
				and(
					eq(invoice.organizationId, ctx.orgId),
					from ? gte(invoice.issuedAt, new Date(`${from}T00:00:00Z`)) : undefined,
					toBound ? lt(invoice.issuedAt, new Date(toBound)) : undefined
				)
			)
			.orderBy(asc(invoice.number));
		body = [
			row(['Number', 'Customer', 'Status', 'Issued', 'Due', 'Total', 'Paid', 'Balance']),
			...rows.map((r) =>
				row([
					`INV-${r.number}`,
					r.customerName,
					// invoice.status stays 'open' in the DB even when fully paid — derive it like the UI badge.
					r.status === 'open' && r.total - r.paid <= 0 ? 'paid' : r.status,
					r.issuedAt.toISOString().slice(0, 10),
					r.dueDate,
					money(r.total),
					money(r.paid),
					money(r.total - r.paid)
				])
			)
		].join('\n');
	} else if (kind === 'jobs') {
		const rows = await db
			.select({
				number: job.number,
				customerName: customer.name,
				typeName: jobType.name,
				technicianName: user.name,
				status: job.status,
				priority: job.priority,
				startsAt: job.startsAt,
				completedAt: job.completedAt,
				createdAt: job.createdAt
			})
			.from(job)
			.innerJoin(
				customer,
				and(eq(job.customerId, customer.id), eq(customer.organizationId, job.organizationId))
			)
			.leftJoin(jobType, eq(job.jobTypeId, jobType.id))
			.leftJoin(member, eq(job.technicianId, member.id))
			.leftJoin(user, eq(member.userId, user.id))
			.where(
				and(
					eq(job.organizationId, ctx.orgId),
					from ? gte(job.createdAt, new Date(`${from}T00:00:00Z`)) : undefined,
					toBound ? lt(job.createdAt, new Date(toBound)) : undefined
				)
			)
			.orderBy(desc(job.number));
		body = [
			row([
				'Job',
				'Customer',
				'Type',
				'Technician',
				'Status',
				'Priority',
				'Scheduled',
				'Completed',
				'Created'
			]),
			...rows.map((r) =>
				row([
					`J-${r.number}`,
					r.customerName,
					r.typeName ?? '',
					r.technicianName ?? '',
					r.status,
					r.priority,
					r.startsAt ? r.startsAt.toISOString() : '',
					r.completedAt ? r.completedAt.toISOString().slice(0, 10) : '',
					r.createdAt.toISOString().slice(0, 10)
				])
			)
		].join('\n');
	} else if (kind === 'time-entries') {
		const rows = await db
			.select({
				memberName: user.name,
				jobNumber: job.number,
				customerName: customer.name,
				startedAt: jobTimeEntry.startedAt,
				endedAt: jobTimeEntry.endedAt,
				note: jobTimeEntry.note
			})
			.from(jobTimeEntry)
			.leftJoin(member, eq(jobTimeEntry.memberId, member.id))
			.leftJoin(user, eq(member.userId, user.id))
			.innerJoin(job, eq(jobTimeEntry.jobId, job.id))
			.innerJoin(
				customer,
				and(eq(job.customerId, customer.id), eq(customer.organizationId, job.organizationId))
			)
			.where(
				and(
					eq(jobTimeEntry.organizationId, ctx.orgId),
					from ? gte(jobTimeEntry.startedAt, new Date(`${from}T00:00:00Z`)) : undefined,
					toBound ? lt(jobTimeEntry.startedAt, new Date(toBound)) : undefined
				)
			)
			.orderBy(asc(jobTimeEntry.startedAt));
		body = [
			row(['Member', 'Job', 'Customer', 'Start', 'End', 'Minutes', 'Note']),
			...rows.map((r) =>
				row([
					r.memberName ?? '—',
					`J-${r.jobNumber}`,
					r.customerName,
					`${localDate(r.startedAt, 'UTC')} ${localTime(r.startedAt, 'UTC')}`,
					r.endedAt ? `${localDate(r.endedAt, 'UTC')} ${localTime(r.endedAt, 'UTC')}` : '',
					r.endedAt ? Math.round((r.endedAt.getTime() - r.startedAt.getTime()) / 60000) : '',
					r.note
				])
			)
		].join('\n');
	} else if (kind === 'quickbooks') {
		// QuickBooks Online invoice-import shape: one row per line item, invoice fields repeated.
		const rows = await db
			.select({
				number: invoice.number,
				customerName: customer.name,
				issuedAt: invoice.issuedAt,
				dueDate: invoice.dueDate,
				name: invoiceItem.name,
				description: invoiceItem.description,
				qty: invoiceItem.qty,
				unitPrice: invoiceItem.unitPrice
			})
			.from(invoiceItem)
			.innerJoin(invoice, eq(invoiceItem.invoiceId, invoice.id))
			.innerJoin(
				customer,
				and(
					eq(invoice.customerId, customer.id),
					eq(customer.organizationId, invoice.organizationId)
				)
			)
			.where(
				and(
					eq(invoice.organizationId, ctx.orgId),
					from ? gte(invoice.issuedAt, new Date(`${from}T00:00:00Z`)) : undefined,
					toBound ? lt(invoice.issuedAt, new Date(toBound)) : undefined
				)
			)
			.orderBy(asc(invoice.number));
		body = [
			row([
				'InvoiceNo',
				'Customer',
				'InvoiceDate',
				'DueDate',
				'Item',
				'ItemDescription',
				'ItemQuantity',
				'ItemRate',
				'ItemAmount'
			]),
			...rows.map((r) =>
				row([
					`INV-${r.number}`,
					r.customerName,
					r.issuedAt.toISOString().slice(0, 10),
					r.dueDate,
					r.name,
					r.description,
					r.qty,
					money(r.unitPrice),
					money(r.qty * r.unitPrice)
				])
			)
		].join('\n');
	} else if (kind === 'payments') {
		const rows = await db
			.select({
				id: payment.id,
				customerName: customer.name,
				amount: payment.amount,
				method: payment.method,
				reference: payment.reference,
				paidAt: payment.paidAt,
				invoiceNumber: invoice.number
			})
			.from(payment)
			.innerJoin(
				customer,
				and(
					eq(payment.customerId, customer.id),
					eq(customer.organizationId, payment.organizationId)
				)
			)
			.leftJoin(
				charge,
				and(
					eq(payment.chargeId, charge.id),
					eq(charge.organizationId, payment.organizationId),
					eq(charge.customerId, payment.customerId)
				)
			)
			.leftJoin(invoice, eq(charge.invoiceId, invoice.id))
			.where(
				and(
					eq(payment.organizationId, ctx.orgId),
					from ? gte(payment.paidAt, new Date(`${from}T00:00:00Z`)) : undefined,
					toBound ? lt(payment.paidAt, new Date(toBound)) : undefined
				)
			)
			.orderBy(asc(payment.paidAt));
		body = [
			row(['Payment', 'Customer', 'Date', 'Amount', 'Method', 'Invoice', 'Reference']),
			...rows.map((r) =>
				row([
					r.id.slice(0, 8),
					r.customerName,
					r.paidAt.toISOString().slice(0, 10),
					money(r.amount),
					r.method,
					r.invoiceNumber ? `INV-${r.invoiceNumber}` : '',
					r.reference
				])
			)
		].join('\n');
	} else if (kind === 'statement') {
		// Per-customer account statement: every non-void charge with running balance.
		const customerId = url.searchParams.get('customer');
		if (!customerId) error(400, 'Pass ?customer=<id>');
		const [cust] = await db
			.select({ id: customer.id, name: customer.name })
			.from(customer)
			.where(and(eq(customer.id, customerId), eq(customer.organizationId, ctx.orgId)))
			.limit(1);
		if (!cust) error(404, 'Customer not found');
		const rows = await db
			.select({
				charge: charge,
				jobNumber: job.number,
				invoiceNumber: invoice.number,
				paid: sql<number>`coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${outer(charge.id)} and p.organization_id = ${outer(charge.organizationId)} and p.customer_id = ${outer(charge.customerId)}), 0)`.mapWith(
					Number
				)
			})
			.from(charge)
			.leftJoin(job, eq(charge.jobId, job.id))
			.leftJoin(invoice, eq(charge.invoiceId, invoice.id))
			.where(
				and(
					eq(charge.organizationId, ctx.orgId),
					eq(charge.customerId, customerId),
					sql`${charge.status} != 'void'`
				)
			)
			.orderBy(asc(charge.createdAt));
		let bal = 0;
		const lines = rows.map((r) => {
			bal += r.charge.amount - r.paid;
			return row([
				r.charge.createdAt.toISOString().slice(0, 10),
				r.charge.description,
				r.jobNumber ? `J-${r.jobNumber}` : '',
				r.invoiceNumber ? `INV-${r.invoiceNumber}` : '',
				r.charge.dueDate ?? '',
				money(r.charge.amount),
				money(r.paid),
				money(bal)
			]);
		});
		body = [
			row([`Statement for ${cust.name}`]),
			row(['Date', 'Description', 'Job', 'Invoice', 'Due', 'Amount', 'Paid', 'Balance']),
			...lines,
			row(['', '', '', '', '', '', 'Balance due', money(bal)])
		].join('\n');
	} else if (kind === 'xero') {
		// Xero sales-invoice import shape: one row per line item.
		const rows = await db
			.select({
				number: invoice.number,
				customerName: customer.name,
				email: customer.email,
				issuedAt: invoice.issuedAt,
				dueDate: invoice.dueDate,
				name: invoiceItem.name,
				description: invoiceItem.description,
				qty: invoiceItem.qty,
				unitPrice: invoiceItem.unitPrice
			})
			.from(invoiceItem)
			.innerJoin(invoice, eq(invoiceItem.invoiceId, invoice.id))
			.innerJoin(
				customer,
				and(
					eq(invoice.customerId, customer.id),
					eq(customer.organizationId, invoice.organizationId)
				)
			)
			.where(
				and(
					eq(invoice.organizationId, ctx.orgId),
					from ? gte(invoice.issuedAt, new Date(`${from}T00:00:00Z`)) : undefined,
					toBound ? lt(invoice.issuedAt, new Date(toBound)) : undefined
				)
			)
			.orderBy(asc(invoice.number));
		body = [
			row([
				'ContactName',
				'EmailAddress',
				'InvoiceNumber',
				'InvoiceDate',
				'DueDate',
				'Description',
				'Quantity',
				'UnitAmount',
				'AccountCode',
				'TaxType'
			]),
			...rows.map((r) =>
				row([
					r.customerName,
					r.email,
					`INV-${r.number}`,
					r.issuedAt.toISOString().slice(0, 10),
					r.dueDate,
					r.description || r.name,
					r.qty,
					money(r.unitPrice),
					'200',
					'NONE'
				])
			)
		].join('\n');
	} else if (kind === 'estimates') {
		const rows = await db
			.select({
				number: estimate.number,
				version: estimate.version,
				customerName: customer.name,
				status: estimate.status,
				sentAt: estimate.sentAt,
				validUntil: estimate.validUntil,
				createdAt: estimate.createdAt,
				total:
					sql<number>`coalesce((select sum(i.qty * i.unit_price) from ${estimateItem} i where i.estimate_id = ${outer(estimate.id)} and i.optional = false), 0)`.mapWith(
						Number
					)
			})
			.from(estimate)
			.innerJoin(
				customer,
				and(
					eq(estimate.customerId, customer.id),
					eq(customer.organizationId, estimate.organizationId)
				)
			)
			.where(
				and(
					eq(estimate.organizationId, ctx.orgId),
					from ? gte(estimate.createdAt, new Date(`${from}T00:00:00Z`)) : undefined,
					toBound ? lt(estimate.createdAt, new Date(toBound)) : undefined
				)
			)
			.orderBy(asc(estimate.number), asc(estimate.version));
		body = [
			row(['Estimate', 'Version', 'Customer', 'Status', 'Total', 'Sent', 'Valid until', 'Created']),
			...rows.map((r) =>
				row([
					`E-${r.number}`,
					r.version,
					r.customerName,
					r.status,
					money(r.total),
					r.sentAt ? r.sentAt.toISOString().slice(0, 10) : '',
					r.validUntil ?? '',
					r.createdAt.toISOString().slice(0, 10)
				])
			)
		].join('\n');
	} else if (kind === 'customers') {
		const rows = await db
			.select()
			.from(customer)
			.where(eq(customer.organizationId, ctx.orgId))
			.orderBy(asc(customer.name));
		body = [
			row(['Name', 'Company', 'Type', 'Status', 'Email', 'Phone', 'Tags', 'Lead source', 'Since']),
			...rows.map((r) =>
				row([
					r.name,
					r.companyName,
					r.type,
					r.status,
					r.email,
					r.phone,
					(r.tags ?? []).join('; '),
					r.leadSource,
					r.since
				])
			)
		].join('\n');
	} else if (kind === 'inventory') {
		const rows = await db
			.select()
			.from(inventoryItem)
			.where(eq(inventoryItem.organizationId, ctx.orgId))
			.orderBy(asc(inventoryItem.name));
		body = [
			row(['Name', 'SKU', 'Unit', 'On hand', 'Reorder at', 'Unit cost', 'Stock value', 'Notes']),
			...rows.map((r) =>
				row([
					r.name,
					r.sku,
					r.unit,
					r.qtyOnHand,
					r.reorderPoint ?? '',
					money(r.unitCost),
					money(r.qtyOnHand * r.unitCost),
					r.notes
				])
			)
		].join('\n');
	} else if (kind === 'pricebook') {
		const rows = await db
			.select()
			.from(pricebookItem)
			.where(eq(pricebookItem.organizationId, ctx.orgId))
			.orderBy(asc(pricebookItem.category), asc(pricebookItem.name));
		body = [
			row(['Name', 'Category', 'Kind', 'Price', 'Duration min', 'Description', 'Active']),
			...rows.map((r) =>
				row([
					r.name,
					r.category,
					r.kind,
					money(r.price),
					r.durationMin ?? '',
					r.description,
					r.active ? 'yes' : 'no'
				])
			)
		].join('\n');
	} else if (kind === 'payroll') {
		// Week's time entries for payroll import — same org-tz bounds as /payroll, admins only.
		if (ctx.role === 'member') error(403, 'Only owners and admins can export payroll');
		if (!from || !to) error(400, 'Pass ?from=&to= YYYY-MM-DD');
		const t = (await getSettings(ctx.orgId)).timezone;
		const approver = alias(user, 'payroll_approver');
		const rows = await db
			.select({
				memberName: user.name,
				jobNumber: job.number,
				customerName: customer.name,
				startedAt: jobTimeEntry.startedAt,
				endedAt: jobTimeEntry.endedAt,
				approvedAt: jobTimeEntry.approvedAt,
				approvedByName: approver.name,
				laborCostCents: member.laborCostCents,
				overtimePct: member.overtimePct,
				memberId: jobTimeEntry.memberId,
				note: jobTimeEntry.note
			})
			.from(jobTimeEntry)
			.leftJoin(member, eq(jobTimeEntry.memberId, member.id))
			.leftJoin(user, eq(member.userId, user.id))
			.leftJoin(approver, eq(jobTimeEntry.approvedById, approver.id))
			.leftJoin(job, eq(jobTimeEntry.jobId, job.id))
			.leftJoin(
				customer,
				and(eq(job.customerId, customer.id), eq(customer.organizationId, job.organizationId))
			)
			.where(
				and(
					eq(jobTimeEntry.organizationId, ctx.orgId),
					gte(jobTimeEntry.startedAt, zonedToUtc(`${from}T00:00`, t)),
					lt(jobTimeEntry.startedAt, zonedToUtc(`${addDays(to, 1)}T00:00`, t))
				)
			)
			.orderBy(asc(user.name), asc(jobTimeEntry.startedAt));
		// OT-aware labor cost: per member+week, minutes past 40h bill at overtimePct
		// of the loaded rate. Rows arrive member-sorted so a running tally works.
		const weekOf = (d: Date) => {
			const day = localDate(d, t);
			const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
			return addDays(day, -((dow + 6) % 7));
		};
		const weekCum = new Map<string, number>();
		const costed = rows.map((r) => {
			const min = r.endedAt ? Math.round((r.endedAt.getTime() - r.startedAt.getTime()) / 60000) : 0;
			const wkKey = `${r.memberId ?? '—'}:${weekOf(r.startedAt)}`;
			const before = weekCum.get(wkKey) ?? 0;
			weekCum.set(wkKey, before + min);
			const ot = Math.max(0, before + min - Math.max(40 * 60, before));
			const cost =
				r.endedAt && r.laborCostCents
					? Math.round(
							((min - ot) / 60) * r.laborCostCents +
								(ot / 60) * r.laborCostCents * ((r.overtimePct ?? 150) / 100)
						)
					: null;
			return { r, ot, cost };
		});
		body = [
			row([
				'Member',
				'Job',
				'Customer',
				'Date',
				'Start',
				'End',
				'Minutes',
				'OT min',
				'Approved',
				'Approved by',
				'Labor cost',
				'Note'
			]),
			...costed.map(({ r, ot, cost }) =>
				row([
					r.memberName ?? '—',
					r.jobNumber ? `J-${r.jobNumber}` : '',
					r.customerName ?? '',
					localDate(r.startedAt, t),
					localTime(r.startedAt, t),
					r.endedAt ? localTime(r.endedAt, t) : '',
					r.endedAt ? Math.round((r.endedAt.getTime() - r.startedAt.getTime()) / 60000) : '',
					ot || '',
					r.approvedAt ? 'yes' : 'no',
					r.approvedByName ?? '',
					cost != null ? money(cost) : '',
					r.note
				])
			)
		].join('\n');
	} else if (kind === 'workspace') {
		// Full org JSON backup — admins/owners only, and no shared secret is worth
		// returning here: provider keys, webhook secrets and API keys stay out.
		if (ctx.role !== 'owner' && ctx.role !== 'admin')
			error(403, 'Only owners and admins can export the workspace');
		const data = await exportWorkspace(ctx.orgId);
		return new Response(`${JSON.stringify(data, null, 2)}\n`, {
			headers: {
				'content-type': 'application/json; charset=utf-8',
				'content-disposition': `attachment; filename="tredaro-workspace-${filenameDate}.json"`
			}
		});
	} else {
		error(
			404,
			'Unknown export — try invoices, time-entries, quickbooks, xero, payments, customers, estimates, inventory, pricebook, statement or workspace'
		);
	}

	return new Response(`${body}\n`, {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="tredaro-${kind}-${filenameDate}.csv"`
		}
	});
};
