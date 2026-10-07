import { error } from '@sveltejs/kit';
import { and, asc, eq, gte, lt, sql } from 'drizzle-orm';
import { requireOrg } from '#lib/server/context.ts';
import { db } from '#lib/server/db/index.ts';
import {
	customer,
	invoice,
	invoiceItem,
	job,
	jobTimeEntry,
	member,
	outer,
	payment,
	charge,
	user
} from '#lib/server/db/schema.ts';
import { localDate, localTime } from '#lib/tz.ts';
import type { RequestHandler } from './$types';

const cell = (v: unknown) => {
	const s = v == null ? '' : String(v);
	return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const row = (cells: unknown[]) => cells.map(cell).join(',');
const money = (cents: number | null | undefined) => (cents == null ? '' : (cents / 100).toFixed(2));

/** CSV exports for staff: `GET /api/export/invoices.csv` or `/api/export/time-entries.csv` (optional ?from=&to= YYYY-MM-DD). */
export const GET: RequestHandler = async ({ params, url }) => {
	const ctx = await requireOrg();
	const kind = params.kind?.replace(/\.csv$/, '');
	const from = url.searchParams.get('from');
	const to = url.searchParams.get('to');
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
				paid: sql<number>`coalesce((select sum(p.amount) from ${payment} p inner join ${charge} c on p.charge_id = c.id where c.invoice_id = ${outer(invoice.id)}), 0)`.mapWith(
					Number
				)
			})
			.from(invoice)
			.innerJoin(customer, eq(invoice.customerId, customer.id))
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
					r.status,
					r.issuedAt.toISOString().slice(0, 10),
					r.dueDate,
					money(r.total),
					money(r.paid),
					money(r.total - r.paid)
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
			.innerJoin(customer, eq(job.customerId, customer.id))
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
	} else {
		error(404, 'Unknown export — try invoices or time-entries');
	}

	return new Response(`${body}\n`, {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="tredaro-${kind}-${filenameDate}.csv"`
		}
	});
};
