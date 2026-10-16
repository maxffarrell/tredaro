import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { OrgContext } from '#lib/server/context.ts';

vi.mock(
	'$app/env/private',
	() =>
		new Proxy(
			{
				DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://localhost/unavailable',
				BETTER_AUTH_SECRET: 'public-link-concurrency-test-only'
			} as Record<string, unknown>,
			{ get: (t, k) => t[String(k)], has: () => true }
		)
);
vi.mock('./notifications.ts', () => ({
	notifyInvoiceSent: vi.fn(async () => true),
	notifyBookingCancelled: vi.fn(async () => undefined),
	notifyRescheduleRequested: vi.fn(async () => undefined),
	notifyLowStock: vi.fn(),
	rearmLowStock: vi.fn()
}));

import { db, type DbOrTx } from '#lib/server/db/index.ts';
import {
	activity,
	charge,
	companySettings,
	customer,
	estimate,
	estimateItem,
	invoice,
	invoiceItem,
	job,
	jobEvent,
	organization,
	user
} from '#lib/server/db/schema.ts';
import { decideEstimate, decideEstimateStaff, estimateToken, reviseEstimate } from './estimates.ts';
import { cancelBookedJob, requestReschedule } from './jobs.ts';
import {
	notifyBookingCancelled,
	notifyInvoiceSent,
	notifyRescheduleRequested
} from './notifications.ts';

const uid = randomUUID();
let orgId: string, customerId: string, ctx: OrgContext;
let mailSnapshots: { status: string; invoiceId: string }[];

/** Hold a real PostgreSQL lock until the test has observed the waiting requests. */
async function holdRow(setup: (tx: DbOrTx) => Promise<unknown>) {
	const ready = Promise.withResolvers<number>();
	const gate = Promise.withResolvers<void>();
	const transaction = db.transaction(async (tx) => {
		await setup(tx);
		const [row] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
		ready.resolve(row.pid);
		await gate.promise;
	});
	void transaction.catch(ready.reject);
	return {
		pid: await ready.promise,
		release: async () => {
			gate.resolve();
			await transaction;
		}
	};
}

async function waitForBlocked(pid: number, count: number) {
	await vi.waitFor(
		async () => {
			const rows = await db.execute<{ pid: number; blockers: number[] }>(sql`
			select pid, pg_blocking_pids(pid) as blockers from pg_stat_activity
			where datname = current_database() and wait_event_type = 'Lock'
		`);
			const chain = new Set([pid]);
			for (let i = 0; i < rows.length; i++)
				for (const row of rows) if (row.blockers.some((p) => chain.has(p))) chain.add(row.pid);
			expect(chain.size - 1).toBeGreaterThanOrEqual(count);
		},
		{ timeout: 5000, interval: 10 }
	);
}

async function sentEstimate() {
	const id = randomUUID();
	await db.insert(estimate).values({
		id,
		organizationId: orgId,
		customerId,
		number: 1,
		status: 'sent',
		validUntil: '2099-12-31'
	});
	const items = await db
		.insert(estimateItem)
		.values([
			{ estimateId: id, name: 'Repair', qty: 1, unitPrice: 1000, position: 0 },
			{
				estimateId: id,
				name: 'Optional work',
				qty: 1,
				unitPrice: 1000,
				optional: true,
				position: 1
			}
		])
		.returning();
	const token = estimateToken(id);
	const input = {
		token,
		approve: true,
		name: 'Customer',
		items: [items[1].id],
		note: '',
		option: '',
		reason: ''
	};
	return { id, token, input };
}

async function conversionRows() {
	return {
		jobs: await db.select().from(job).where(eq(job.organizationId, orgId)),
		invoices: await db.select().from(invoice).where(eq(invoice.organizationId, orgId)),
		charges: await db.select().from(charge).where(eq(charge.organizationId, orgId)),
		activity: await db.select().from(activity).where(eq(activity.organizationId, orgId))
	};
}

describe.runIf(Boolean(process.env.DATABASE_URL))(
	'public-link transitions in migrated PostgreSQL',
	() => {
		beforeAll(async () => {
			await db.insert(user).values({ id: uid, name: 'Staff', email: `${uid}@example.invalid` });
		});
		beforeEach(async () => {
			vi.clearAllMocks();
			orgId = randomUUID();
			customerId = randomUUID();
			mailSnapshots = [];
			ctx = { orgId, userId: uid } as OrgContext;
			await db
				.insert(organization)
				.values({ id: orgId, name: 'Concurrency test', slug: orgId, createdAt: new Date() });
			await db.insert(companySettings).values({ organizationId: orgId, estimateDepositPct: 50 });
			await db
				.insert(customer)
				.values({ id: customerId, organizationId: orgId, name: 'Recipient' });
			vi.mocked(notifyInvoiceSent).mockImplementation(async (org, id) => {
				const [row] = await db
					.select({ status: estimate.status, invoiceId: invoice.id })
					.from(estimate)
					.innerJoin(invoice, eq(estimate.customerId, invoice.customerId))
					.where(eq(invoice.id, id));
				if (row && org === orgId) mailSnapshots.push(row);
				return true;
			});
		});
		afterEach(async () => {
			await db.delete(organization).where(eq(organization.id, orgId));
		});
		afterAll(async () => {
			await db.delete(user).where(eq(user.id, uid));
		});

		it.each([
			['public', 'public'],
			['public', 'staff'],
			['staff', 'staff']
		] as const)(
			'converts concurrent %s/%s approvals once, including the deposit and post-commit notification',
			async (a, b) => {
				const e = await sentEstimate();
				const lock = await holdRow((tx) =>
					tx.select().from(estimate).where(eq(estimate.id, e.id)).for('update')
				);
				const approve = (path: string) =>
					path === 'public'
						? decideEstimate(e.token, 'test', e.input)
						: decideEstimateStaff(ctx, e.id, true, 'Staff');
				const pending = Promise.allSettled([approve(a), approve(b)]);
				try {
					await waitForBlocked(lock.pid, 2);
					expect(notifyInvoiceSent).not.toHaveBeenCalled();
				} finally {
					await lock.release();
				}
				const results = await pending;
				expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
				expect(results.find((r) => r.status === 'rejected')).toMatchObject({
					reason: { status: 409 }
				});
				const rows = await conversionRows();
				expect(rows.jobs).toHaveLength(1);
				expect(rows.invoices).toHaveLength(1);
				expect(rows.charges).toHaveLength(1);
				expect(rows.charges[0].amount).toBe(1000);
				expect(rows.activity.map((r) => `${r.entityType}.${r.action}`).sort()).toEqual([
					'estimate.approved',
					'invoice.issued',
					'job.created'
				]);
				const [saved] = await db.select().from(estimate).where(eq(estimate.id, e.id));
				expect(saved).toMatchObject({
					status: 'converted',
					jobId: rows.jobs[0].id,
					acceptedItems: e.input.items
				});
				await vi.waitFor(() =>
					expect(mailSnapshots).toEqual([{ status: 'converted', invoiceId: rows.invoices[0].id }])
				);
				expect(notifyInvoiceSent).toHaveBeenCalledTimes(1);
			}
		);

		it.each(['revise', 'decline'] as const)(
			'honors a staff %s queued before public approval',
			async (action) => {
				const e = await sentEstimate();
				const lock = await holdRow((tx) =>
					tx.select().from(estimate).where(eq(estimate.id, e.id)).for('update')
				);
				const staff = Promise.allSettled([
					action === 'revise'
						? reviseEstimate(ctx, e.id)
						: decideEstimateStaff(ctx, e.id, false, 'Staff')
				]);
				let pending: ReturnType<typeof Promise.allSettled> | undefined;
				try {
					await waitForBlocked(lock.pid, 1);
					pending = Promise.allSettled([decideEstimate(e.token, 'test', e.input)]);
					await waitForBlocked(lock.pid, 2);
				} finally {
					await lock.release();
				}
				expect((await staff)[0].status).toBe('fulfilled');
				expect((await pending!)[0]).toMatchObject({
					status: 'rejected',
					reason: { status: action === 'revise' ? 404 : 409 }
				});
				const [saved] = await db.select().from(estimate).where(eq(estimate.id, e.id));
				expect(saved.status).toBe(action === 'revise' ? 'superseded' : 'declined');
				const rows = await conversionRows();
				expect(rows.jobs).toHaveLength(0);
				expect(rows.invoices).toHaveLength(0);
				expect(rows.charges).toHaveLength(0);
				expect(rows.activity.map((r) => r.action)).toEqual([
					action === 'revise' ? 'revised' : 'declined'
				]);
				expect(notifyInvoiceSent).not.toHaveBeenCalled();
			}
		);

		it.each(['revise', 'decline'] as const)(
			'rejects a staff %s queued after public approval without overwriting conversion',
			async (action) => {
				const e = await sentEstimate();
				const lock = await holdRow((tx) =>
					tx.select().from(estimate).where(eq(estimate.id, e.id)).for('update')
				);
				const approval = Promise.allSettled([decideEstimate(e.token, 'test', e.input)]);
				let staff: ReturnType<typeof Promise.allSettled> | undefined;
				try {
					await waitForBlocked(lock.pid, 1);
					staff = Promise.allSettled([
						action === 'revise'
							? reviseEstimate(ctx, e.id)
							: decideEstimateStaff(ctx, e.id, false, 'Staff')
					]);
					await waitForBlocked(lock.pid, 2);
				} finally {
					await lock.release();
				}
				expect((await approval)[0].status).toBe('fulfilled');
				expect((await staff!)[0]).toMatchObject({ status: 'rejected', reason: { status: 409 } });
				const [saved] = await db.select().from(estimate).where(eq(estimate.id, e.id));
				expect(saved.status).toBe('converted');
				expect((await conversionRows()).jobs).toHaveLength(1);
			}
		);

		it('rechecks public eligibility after a concurrent expiry under the row lock', async () => {
			const e = await sentEstimate();
			const lock = await holdRow((tx) =>
				tx.update(estimate).set({ validUntil: '2000-01-01' }).where(eq(estimate.id, e.id))
			);
			const pending = Promise.allSettled([decideEstimate(e.token, 'test', e.input)]);
			try {
				await waitForBlocked(lock.pid, 1);
			} finally {
				await lock.release();
			}
			expect((await pending)[0]).toMatchObject({ status: 'rejected', reason: { status: 404 } });
			expect((await conversionRows()).jobs).toHaveLength(0);
			expect(notifyInvoiceSent).not.toHaveBeenCalled();
		});

		it.each(['deposit', 'decision'] as const)(
			'rolls back jobs, invoices, charges, activity and counters on a late %s failure',
			async (failure) => {
				const e = await sentEstimate();
				const fn = sql.identifier(`test_reject_decision_${randomUUID().replaceAll('-', '')}`);
				const trigger = sql.identifier(`test_reject_decision_${randomUUID().replaceAll('-', '')}`);
				if (failure === 'deposit') {
					await db
						.update(estimateItem)
						.set({ qty: 4, unitPrice: 2147483647 })
						.where(eq(estimateItem.estimateId, e.id));
				} else {
					await db.execute(sql`create function ${fn}() returns trigger language plpgsql as $$
				begin raise exception 'test-only late decision failure'; end; $$`);
					await db.execute(sql`create trigger ${trigger} before update on ${estimate}
				for each row when (new.decision_name = 'TEST_ONLY_REJECT_APPROVAL') execute function ${fn}()`);
				}
				try {
					await expect(
						decideEstimate(e.token, 'test', { ...e.input, name: 'TEST_ONLY_REJECT_APPROVAL' })
					).rejects.toThrow();
					const rows = await conversionRows();
					expect(rows.jobs).toHaveLength(0);
					expect(rows.invoices).toHaveLength(0);
					expect(rows.charges).toHaveLength(0);
					expect(rows.activity).toHaveLength(0);
					const [saved] = await db.select().from(estimate).where(eq(estimate.id, e.id));
					expect(saved).toMatchObject({ status: 'sent', jobId: null, respondedAt: null });
					const [settings] = await db
						.select()
						.from(companySettings)
						.where(eq(companySettings.organizationId, orgId));
					expect(settings).toMatchObject({ nextJobNumber: 1, nextInvoiceNumber: 1 });
					expect(
						await db
							.select()
							.from(invoiceItem)
							.innerJoin(invoice, eq(invoiceItem.invoiceId, invoice.id))
							.where(eq(invoice.organizationId, orgId))
					).toHaveLength(0);
					expect(notifyInvoiceSent).not.toHaveBeenCalled();
				} finally {
					if (failure === 'decision') {
						await db.execute(sql`drop trigger ${trigger} on ${estimate}`);
						await db.execute(sql`drop function ${fn}()`);
					}
				}
			}
		);

		it.each([
			['cancel', 'in_progress', null],
			['cancel', 'done', null],
			['cancel', 'scheduled', new Date()],
			['reschedule', 'in_progress', null],
			['reschedule', 'done', null],
			['reschedule', 'cancelled', new Date()]
		] as const)(
			'does not overwrite a concurrent %s visit transition to %s or notify',
			async (action, status, cancelledAt) => {
				const id = randomUUID();
				await db.insert(job).values({
					id,
					organizationId: orgId,
					customerId,
					number: 1,
					status: 'scheduled',
					summary: 'Visit'
				});
				const lock = await holdRow((tx) =>
					tx.update(job).set({ status, cancelledAt }).where(eq(job.id, id))
				);
				const pending = Promise.allSettled([
					action === 'cancel'
						? cancelBookedJob(id)
						: requestReschedule(id, { date: '2099-01-01', slot: 'Morning', note: 'Move please' })
				]);
				try {
					await waitForBlocked(lock.pid, 1);
				} finally {
					await lock.release();
				}
				const [result] = await pending;
				if (action === 'cancel' && cancelledAt)
					expect(result).toMatchObject({ status: 'fulfilled', value: { already: true } });
				else expect(result).toMatchObject({ status: 'rejected', reason: { status: 404 } });
				const [saved] = await db.select().from(job).where(eq(job.id, id));
				expect(saved).toMatchObject({
					status,
					cancelledAt,
					preferredTime: null,
					cancelReason: null
				});
				expect(await db.select().from(jobEvent).where(eq(jobEvent.jobId, id))).toHaveLength(0);
				expect((await conversionRows()).activity).toHaveLength(0);
				expect(notifyBookingCancelled).not.toHaveBeenCalled();
				expect(notifyRescheduleRequested).not.toHaveBeenCalled();
			}
		);

		it('keeps cancellation idempotent while retaining legitimate rescheduling', async () => {
			const id = randomUUID();
			await db.insert(job).values({
				id,
				organizationId: orgId,
				customerId,
				number: 1,
				status: 'scheduled',
				summary: 'Visit'
			});
			expect(
				await requestReschedule(id, { date: '2099-01-01', slot: 'Morning', note: 'Move please' })
			).toEqual({ ok: true });
			expect(notifyRescheduleRequested).toHaveBeenCalledTimes(1);
			expect(await cancelBookedJob(id)).toMatchObject({
				already: false,
				job: { status: 'cancelled' }
			});
			expect(await cancelBookedJob(id)).toMatchObject({ already: true });
			expect(notifyBookingCancelled).toHaveBeenCalledTimes(1);
		});
	}
);
