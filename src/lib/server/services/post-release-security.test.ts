import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import * as v from 'valibot';
import * as s from '#lib/schemas.ts';
import type { OrgContext } from '../context.ts';
vi.mock(
	'$app/env/private',
	() =>
		new Proxy(
			{
				DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://localhost/unavailable',
				BETTER_AUTH_SECRET: 'post-release-test-only'
			} as Record<string, unknown>,
			{ get: (t, k) => t[String(k)], has: () => true }
		)
);
vi.mock('./events.ts', () => ({ emit: vi.fn(async () => undefined) }));
vi.mock('./notifications.ts', () => ({
	sendSmsQuiet: vi.fn(async () => undefined),
	ackInboundSms: vi.fn(async () => undefined),
	ackConfirmSms: vi.fn(async () => undefined),
	ackRatingSms: vi.fn(async () => undefined),
	flushSmsOutbox: vi.fn(async () => undefined),
	logOnce: vi.fn(async () => undefined),
	notifyTimeApproved: vi.fn(async () => undefined),
	notifyTimeFlagged: vi.fn(async () => undefined),
	notifyEstimateSent: vi.fn(async () => undefined),
	notifyEstimateResent: vi.fn(async () => undefined),
	notifyBookingReceived: vi.fn(async () => undefined),
	notifyBookingCancelled: vi.fn(async () => undefined),
	notifyRescheduleRequested: vi.fn(async () => undefined),
	notifyBookingConfirmationSms: vi.fn(async () => undefined),
	notifyInvoiceSent: vi.fn(async () => undefined),
	notifyInvoiceTexted: vi.fn(async () => undefined),
	textCustomer: vi.fn(async () => undefined),
	textJobEta: vi.fn(async () => undefined),
	textDayEtas: vi.fn(async () => undefined),
	emailStatement: vi.fn(async () => undefined),
	notifyJobScheduled: vi.fn(async () => undefined),
	notifyJobRescheduledCustomer: vi.fn(async () => undefined),
	notifyJobCancelled: vi.fn(async () => undefined),
	notifyVisitCancelDeclined: vi.fn(async () => undefined),
	notifyAppointmentReminder: vi.fn(async () => undefined),
	notifyEstimateFollowup: vi.fn(async () => undefined),
	notifyEstimateExpiring: vi.fn(async () => undefined),
	notifyInvoiceOverdue: vi.fn(async () => undefined),
	runWeeklyDigest: vi.fn(async () => undefined),
	notifyChargeDueSoon: vi.fn(async () => undefined),
	runMonthlyStatements: vi.fn(async () => undefined),
	runReminders: vi.fn(async () => undefined),
	notifyJobEnRoute: vi.fn(async () => undefined),
	notifyJobCompleted: vi.fn(async () => undefined),
	notifyStaffBooking: vi.fn(async () => undefined),
	notifyStaffVisitCancel: vi.fn(async () => undefined),
	notifyChargeDispute: vi.fn(async () => undefined),
	notifyPortalMessage: vi.fn(async () => undefined),
	notifyLowStock: vi.fn(async () => undefined),
	rearmLowStock: vi.fn(async () => undefined),
	notifyPartsDelay: vi.fn(async () => undefined),
	notifyVisitRated: vi.fn(async () => undefined),
	notifyAutoChargeFailed: vi.fn(async () => undefined),
	emailAutoChargeFailedToCustomer: vi.fn(async () => undefined),
	notifyJobUnblocked: vi.fn(async () => undefined),
	notifyTechAssigned: vi.fn(async () => undefined),
	notifyTechRescheduled: vi.fn(async () => undefined),
	notifyStaffEstimateDecision: vi.fn(async () => undefined),
	notifyStaffEstimateViewed: vi.fn(async () => undefined),
	notifyStaffInvoiceViewed: vi.fn(async () => undefined),
	notifyVisitPreference: vi.fn(async () => undefined),
	notifyTimeOffRequest: vi.fn(async () => undefined),
	notifyStaffEstimateChanges: vi.fn(async () => undefined),
	notifyStaffQuoteRequest: vi.fn(async () => undefined),
	notifyStaffDocument: vi.fn(async () => undefined),
	notifyPaymentReceived: vi.fn(async () => undefined),
	notifyPartsArrived: vi.fn(async () => undefined),
	runCreditHolds: vi.fn(async () => undefined),
	notifyServiceReport: vi.fn(async () => undefined),
	previewAnnouncement: vi.fn(async () => undefined),
	sendAnnouncement: vi.fn(async () => undefined),
	notifyWaitlistSignup: vi.fn(async () => undefined)
}));
import { db } from '../db/index.ts';
import {
	organization,
	user,
	member,
	customer,
	job,
	jobType,
	pricebookItem,
	estimate,
	estimateItem,
	maintenanceSchedule,
	followUp,
	bookingWaitlist,
	companySettings
} from '../db/schema.ts';
import { portalOverview } from './portal.ts';
import {
	createEstimate,
	updateEstimate,
	getEstimate,
	duplicateEstimate,
	reviseEstimate
} from './estimates.ts';
import { createInvoice } from './billing.ts';
import { addFollowUp, dueFollowUps } from './followups.ts';
import { updateSchedule, runSchedules, listSchedules } from './maintenance.ts';
import { joinWaitlist } from './public.ts';
import { waitlistContact } from '../public-submission-limits.ts';
const orgs = [randomUUID(), randomUUID(), randomUUID()],
	uid = randomUUID(),
	mid = randomUUID();
const customers = [randomUUID(), randomUUID(), randomUUID()],
	jobs = [randomUUID(), randomUUID()],
	types = [randomUUID(), randomUUID()],
	prices = [randomUUID(), randomUUID()];
const eid = randomUUID(),
	scid = randomUUID();
const ctx = {
	orgId: orgs[0],
	userId: uid,
	role: 'owner',
	org: { id: orgs[0], name: 'Test', slug: orgs[0], logo: null }
} as OrgContext;
const line = (id: string | null) => ({
	pricebookItemId: id,
	name: 'Own line',
	description: '',
	qty: 1,
	unitPrice: 1000
});
const today = new Date().toISOString().slice(0, 10);
describe('contact identity normalization', () => {
	it('retains formatted contacts but gives phone spellings the same quota identity', () => {
		expect(waitlistContact({ phone: '(512) 555-1234' }).destinations).toEqual(
			waitlistContact({ phone: '+1 512 555 1234' }).destinations
		);
		expect(waitlistContact({ email: ' Test@Example.COM ' }).email).toBe('test@example.com');
		expect(() => waitlistContact({ phone: 'abc5125551234' })).toThrow();
	});
});
describe.runIf(Boolean(process.env.DATABASE_URL))(
	'post-release boundaries in migrated PostgreSQL',
	() => {
		beforeAll(async () => {
			await db.insert(user).values({ id: uid, name: 'Staff', email: `${uid}@example.invalid` });
			await db
				.insert(organization)
				.values(orgs.map((id) => ({ id, name: 'Test', slug: id, createdAt: new Date() })));
			await db.insert(member).values({
				id: mid,
				organizationId: orgs[0],
				userId: uid,
				role: 'owner',
				createdAt: new Date()
			});
			await db
				.insert(companySettings)
				.values(orgs.map((organizationId) => ({ organizationId, publicPage: true })));
			await db.insert(customer).values(
				customers.map((id, i) => ({
					id,
					organizationId: orgs[i === 1 ? 1 : 0],
					name: 'Customer'
				}))
			);
			await db.insert(job).values(
				jobs.map((id, i) => ({
					id,
					organizationId: orgs[i],
					customerId: customers[i],
					number: 1
				}))
			);
			await db.insert(jobType).values(
				types.map((id, i) => ({
					id,
					organizationId: orgs[i],
					name: 'PRIVATE FOREIGN TYPE',
					checklist: ['PRIVATE FOREIGN CHECKLIST']
				}))
			);
			await db.insert(pricebookItem).values(
				prices.map((id, i) => ({
					id,
					organizationId: orgs[i],
					name: 'PRIVATE FOREIGN CATALOG',
					unitPrice: 1000,
					taxable: i === 0
				}))
			);
			await db.insert(estimate).values({
				id: eid,
				organizationId: orgs[0],
				customerId: customers[0],
				number: 90,
				notes: 'Public note',
				internalNotes: 'PRIVATE STAFF NOTE'
			});
			await db
				.insert(estimateItem)
				.values({ estimateId: eid, name: 'Old line', unitPrice: 500, position: 0 });
			await db.insert(maintenanceSchedule).values({
				id: scid,
				organizationId: orgs[0],
				customerId: customers[0],
				jobTypeId: types[0],
				intervalDays: 30,
				nextDueOn: today
			});
		}, 15000);
		afterAll(async () => {
			await db.delete(organization).where(inArray(organization.id, orgs));
			await db.delete(user).where(eq(user.id, uid));
		});
		it('portal serialization excludes staff-only estimate fields and retains the customer links', async () => {
			await db.update(estimate).set({ status: 'sent' }).where(eq(estimate.id, eid));
			const result = await portalOverview(customers[0]);
			expect(JSON.stringify(result)).not.toContain('PRIVATE STAFF NOTE');
			expect(result.pendingEstimates[0].estimate).toEqual({ id: eid, number: 90 });
			expect(result.pendingEstimates[0].token).toBeTruthy();
			expect(result.pendingEstimates[0].total).toBe(500);
			await db.update(estimate).set({ status: 'draft' }).where(eq(estimate.id, eid));
		});
		it('foreign catalog IDs are rejected before creation, header edits, line replacement or invoice tax consumption', async () => {
			await expect(
				createEstimate(
					ctx,
					v.parse(s.estimateInput, { customerId: customers[0], items: [line(prices[1])] })
				)
			).rejects.toMatchObject({ status: 404 });
			await expect(
				updateEstimate(ctx, { id: eid, notes: 'Changed', items: [line(prices[1])] })
			).rejects.toMatchObject({ status: 404 });
			expect((await db.select().from(estimate).where(eq(estimate.id, eid)))[0].notes).toBe(
				'Public note'
			);
			expect(
				(await db.select().from(estimateItem).where(eq(estimateItem.estimateId, eid)))[0].name
			).toBe('Old line');
			await expect(
				createInvoice(
					ctx,
					v.parse(s.invoiceInput, { customerId: customers[0], items: [line(prices[1])] })
				)
			).rejects.toMatchObject({ status: 404 });
			const own = await createEstimate(
				ctx,
				v.parse(s.estimateInput, { customerId: customers[0], items: [line(prices[0]), line(null)] })
			);
			expect((await getEstimate(orgs[0], own!.id)).items).toHaveLength(2);
		});
		it('historical poisoned catalog links cannot disclose or propagate through copies and revisions', async () => {
			await db
				.update(estimateItem)
				.set({ pricebookItemId: prices[1] })
				.where(eq(estimateItem.estimateId, eid));
			expect((await getEstimate(orgs[0], eid)).items[0].pricebookName).toBeNull();
			await expect(duplicateEstimate(ctx, eid)).rejects.toMatchObject({ status: 404 });
			await db.update(estimate).set({ status: 'sent' }).where(eq(estimate.id, eid));
			await expect(reviseEstimate(ctx, eid)).rejects.toMatchObject({ status: 404 });
			expect((await db.select().from(estimate).where(eq(estimate.id, eid)))[0].status).toBe('sent');
		});
		it('follow-ups independently authorize customer/job ownership and their relationship', async () => {
			for (const input of [
				{ customerId: customers[1] },
				{ jobId: jobs[1] },
				{ customerId: customers[2], jobId: jobs[0] }
			])
				await expect(
					addFollowUp(ctx, { note: 'Call', dueOn: today, ...input })
				).rejects.toMatchObject({ status: 404 });
			const row = await addFollowUp(ctx, {
				note: 'Call',
				dueOn: today,
				customerId: customers[0],
				jobId: jobs[0]
			});
			expect(row!.customerId).toBe(customers[0]);
			const poisoned = randomUUID();
			await db.insert(followUp).values({
				id: poisoned,
				organizationId: orgs[0],
				memberId: mid,
				customerId: customers[1],
				jobId: jobs[1],
				note: 'Legacy',
				dueOn: today
			});
			const result = (await dueFollowUps(orgs[0], today)).find((r) => r.id === poisoned)!;
			expect(result.customerName).toBeNull();
			expect(result.jobNumber).toBeNull();
		});
		it('schedule edits preserve omitted references, clear null, and refuse foreign types or legacy generation', async () => {
			await expect(updateSchedule(ctx, { id: scid, jobTypeId: types[1] })).rejects.toMatchObject({
				status: 404
			});
			await updateSchedule(ctx, { id: scid, active: true });
			expect(
				(await db.select().from(maintenanceSchedule).where(eq(maintenanceSchedule.id, scid)))[0]
					.jobTypeId
			).toBe(types[0]);
			expect(await runSchedules(orgs[0])).toBe(1);
			expect(await runSchedules(orgs[0])).toBe(0);
			await updateSchedule(ctx, { id: scid, jobTypeId: null });
			expect(
				(await db.select().from(maintenanceSchedule).where(eq(maintenanceSchedule.id, scid)))[0]
					.jobTypeId
			).toBeNull();
			await db
				.update(maintenanceSchedule)
				.set({ jobTypeId: types[1], nextDueOn: today })
				.where(eq(maintenanceSchedule.id, scid));
			expect((await listSchedules(orgs[0]))[0].jobTypeName).toBeNull();
			await expect(runSchedules(orgs[0])).rejects.toMatchObject({ status: 404 });
		});
		it('waitlist contact deduplication is durable and independent of IP or contact spelling', async () => {
			expect(
				await joinWaitlist(orgs[0], { name: 'Caller', phone: '(512) 555-1234' }, randomUUID())
			).toEqual({ ok: true });
			await expect(
				joinWaitlist(orgs[0], { name: 'Caller', phone: '+1 512 555 1234' }, randomUUID())
			).rejects.toMatchObject({ status: 429 });
			expect(
				await db.select().from(bookingWaitlist).where(eq(bookingWaitlist.organizationId, orgs[0]))
			).toHaveLength(1);
			await expect(
				joinWaitlist(
					orgs[0],
					{ name: 'Bot', email: 'bot@example.invalid', website: 'bot' },
					randomUUID()
				)
			).rejects.toMatchObject({ status: 400 });
		});
		it('concurrent anonymous submissions cannot exceed the persistent organization quota', async () => {
			const outcomes = await Promise.allSettled(
				Array.from({ length: 12 }, (_, i) =>
					joinWaitlist(
						orgs[2],
						{ name: 'Caller', email: `${randomUUID()}-${i}@example.invalid` },
						randomUUID()
					)
				)
			);
			expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
			expect(outcomes.filter((r) => r.status === 'rejected')).toHaveLength(2);
			expect(
				await db.select().from(bookingWaitlist).where(eq(bookingWaitlist.organizationId, orgs[2]))
			).toHaveLength(10);
		});
	}
);
