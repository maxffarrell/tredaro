import { error } from '@sveltejs/kit';
import { and, eq, ne } from 'drizzle-orm';
import { requireUser } from '#lib/server/context.ts';
import { db } from '#lib/server/db/index.ts';
import { charge, customer, payment } from '#lib/server/db/schema.ts';
import type { RequestHandler } from './$types';

const csvCell = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`;

/**
 * Portal statement download: `GET /api/portal/statement?customer=<id>` → CSV of
 * the customer's charges and payments with a running balance. The signed-in
 * portal user must own the customer record (same gate as doc uploads).
 */
export const GET: RequestHandler = async ({ url }) => {
	const { user } = requireUser();
	const customerId = url.searchParams.get('customer') ?? '';
	const [c] = await db
		.select({ id: customer.id, name: customer.name, orgId: customer.organizationId })
		.from(customer)
		.where(and(eq(customer.id, customerId), eq(customer.portalUserId, user.id)))
		.limit(1);
	if (!c) error(404, 'Customer not found');

	const [charges, payments] = await Promise.all([
		db
			.select()
			.from(charge)
			.where(
				and(
					eq(charge.organizationId, c.orgId),
					eq(charge.customerId, customerId),
					ne(charge.status, 'void')
				)
			),
		db
			.select()
			.from(payment)
			.where(and(eq(payment.organizationId, c.orgId), eq(payment.customerId, customerId)))
	]);

	type Row = { date: string; type: string; description: string; debit: number; credit: number };
	const rows: Row[] = [
		...charges.map((ch) => ({
			date: ch.createdAt.toISOString().slice(0, 10),
			type: ch.status === 'written_off' ? 'charge (written off)' : 'charge',
			description: ch.description ?? `Charge due ${ch.dueDate}`,
			debit: ch.amount,
			credit: 0
		})),
		...payments.map((p) => ({
			date: p.paidAt.toISOString().slice(0, 10),
			type: `payment (${p.method})`,
			description: p.reference ?? 'Payment received',
			debit: 0,
			credit: p.amount
		}))
	].sort((a, b) => a.date.localeCompare(b.date));

	let balance = 0;
	const lines = ['date,type,description,debit,credit,balance'];
	for (const r of rows) {
		balance += r.debit - r.credit;
		lines.push(
			[
				r.date,
				csvCell(r.type),
				csvCell(r.description),
				(r.debit / 100).toFixed(2),
				(r.credit / 100).toFixed(2),
				(balance / 100).toFixed(2)
			].join(',')
		);
	}
	lines.push(
		[
			new Date().toISOString().slice(0, 10),
			csvCell('balance'),
			'',
			'',
			'',
			(balance / 100).toFixed(2)
		].join(',')
	);

	return new Response(lines.join('\n'), {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="statement-${customerId.slice(0, 8)}.csv"`
		}
	});
};
