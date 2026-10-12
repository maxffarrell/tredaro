import { randomUUID, createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as v from 'valibot';
import { and, eq, inArray } from 'drizzle-orm';

vi.mock(
	'$app/env/private',
	() =>
		new Proxy(
			{
				DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://localhost/unavailable',
				BETTER_AUTH_SECRET: 'security-test-only-secret'
			} as Record<string, unknown>,
			{ get: (target, key) => target[String(key)], has: () => true }
		)
);
vi.mock('./events.ts', () => ({ emit: vi.fn().mockResolvedValue(undefined) }));
import { db } from '#lib/server/db/index.ts';
import {
	charge,
	customer,
	equipment,
	job,
	jobMaterial,
	organization,
	payment,
	serviceLocation,
	user
} from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import * as schemas from '#lib/schemas.ts';
import { createPortalInvite, claimPortal, requestService } from './portal.ts';
import { revokePortalAccess, updateEquipment } from './customers.ts';
import { addCharge, recordPayment, customerBalance } from './billing.ts';
import { createJob, updateJob } from './jobs.ts';
import { addMaterial } from './inventory.ts';
import { getPublicCompany, requestBooking } from './public.ts';
import { getSettings } from './settings.ts';

const orgs = [randomUUID(), randomUUID()];
const users = [randomUUID(), randomUUID()];
const customers = [randomUUID(), randomUUID(), randomUUID()];
const locations = [randomUUID(), randomUUID(), randomUUID()];
const jobs = [randomUUID(), randomUUID()];
const equipmentId = randomUUID();
const ctx: OrgContext = {
	orgId: orgs[0],
	userId: users[0],
	role: 'owner',
	org: { id: orgs[0], name: 'Security test', slug: orgs[0], logo: null }
};

describe.runIf(Boolean(process.env.DATABASE_URL))(
	'security boundaries against migrated Postgres',
	() => {
		beforeAll(async () => {
			await db
				.insert(user)
				.values(users.map((id) => ({ id, name: 'Test', email: `${id}@example.invalid` })));
			await db
				.insert(organization)
				.values(orgs.map((id) => ({ id, name: 'Test', slug: id, createdAt: new Date() })));
			await db.insert(customer).values(
				customers.map((id, i) => ({
					id,
					organizationId: orgs[i === 1 ? 1 : 0],
					name: 'Customer',
					notes: 'private CRM note',
					email: `${id}@example.invalid`
				}))
			);
			await db.insert(serviceLocation).values(
				locations.map((id, i) => ({
					id,
					organizationId: orgs[i === 1 ? 1 : 0],
					customerId: customers[i],
					accessNotes: 'private gate code'
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
			await db.insert(equipment).values({
				id: equipmentId,
				organizationId: orgs[0],
				customerId: customers[0],
				name: 'Boiler'
			});
		}, 15000);
		afterAll(async () => {
			await db.delete(organization).where(inArray(organization.id, orgs));
			await db.delete(user).where(inArray(user.id, users));
		});
		it('rejects foreign customer signing and accepts a single own-customer claim', async () => {
			await expect(createPortalInvite(ctx, customers[1])).rejects.toMatchObject({ status: 404 });
			const token = await createPortalInvite(ctx, customers[0]);
			expect((await claimPortal(token, users[0])).portalUserId).toBe(users[0]);
			await expect(claimPortal(token, users[1])).rejects.toMatchObject({ status: 410 });
		});
		it('revocation and reissue invalidate outstanding invitations', async () => {
			const old = await createPortalInvite(ctx, customers[0]);
			await revokePortalAccess(ctx, customers[0]);
			await expect(claimPortal(old, users[1])).rejects.toMatchObject({ status: 410 });
			const first = await createPortalInvite(ctx, customers[0]);
			const second = await createPortalInvite(ctx, customers[0]);
			await expect(claimPortal(first, users[1])).rejects.toMatchObject({ status: 410 });
			expect((await claimPortal(second, users[0])).id).toBe(customers[0]);
		});
		it('rejects legacy signing-oracle tokens on upgrade', async () => {
			const payload = `${customers[1]}.${Date.now() + 86400000}`;
			const sig = createHmac('sha256', 'security-test-only-secret')
				.update(`portal:${payload}`)
				.digest('base64url');
			await expect(
				claimPortal(`${Buffer.from(payload).toString('base64url')}.${sig}`, users[0])
			).rejects.toMatchObject({ status: 400 });
		});
		it('checks location tenant and customer ownership on creation and partial edits', async () => {
			for (const location of [locations[1], locations[2]]) {
				await expect(
					createJob(
						ctx,
						'UTC',
						v.parse(schemas.jobInput, { customerId: customers[0], serviceLocationId: location })
					)
				).rejects.toMatchObject({ status: 404 });
				await expect(
					updateJob(
						ctx,
						'UTC',
						v.parse(schemas.jobUpdate, { id: jobs[0], serviceLocationId: location })
					)
				).rejects.toMatchObject({ status: 404 });
				await expect(
					updateEquipment(
						ctx,
						v.parse(schemas.equipmentUpdate, { id: equipmentId, serviceLocationId: location })
					)
				).rejects.toMatchObject({ status: 404 });
			}
			expect(
				(
					await updateJob(
						ctx,
						'UTC',
						v.parse(schemas.jobUpdate, { id: jobs[0], serviceLocationId: locations[0] })
					)
				)?.serviceLocationId
			).toBe(locations[0]);
			expect(
				(
					await updateEquipment(
						ctx,
						v.parse(schemas.equipmentUpdate, { id: equipmentId, serviceLocationId: null })
					)
				).serviceLocationId
			).toBe(null);
		});
		it('rejects foreign customer and job charges before inserting financial rows', async () => {
			await expect(
				addCharge(
					ctx,
					v.parse(schemas.chargeInput, {
						customerId: customers[1],
						amount: 1000,
						dueDate: '2026-10-12'
					})
				)
			).rejects.toMatchObject({ status: 404 });
			await expect(
				addCharge(
					ctx,
					v.parse(schemas.chargeInput, {
						customerId: customers[0],
						jobId: jobs[1],
						amount: 1000,
						dueDate: '2026-10-12'
					})
				)
			).rejects.toMatchObject({ status: 404 });
			expect(
				await db
					.select()
					.from(charge)
					.where(and(eq(charge.organizationId, orgs[0]), eq(charge.customerId, customers[1])))
			).toHaveLength(0);
		});
		it('rejects foreign and wrong-customer charges while preserving own payments', async () => {
			const [foreign] = await db
				.insert(charge)
				.values({
					organizationId: orgs[1],
					customerId: customers[1],
					amount: 1000,
					dueDate: '2026-10-12'
				})
				.returning();
			const [other] = await db
				.insert(charge)
				.values({
					organizationId: orgs[0],
					customerId: customers[2],
					amount: 1000,
					dueDate: '2026-10-12'
				})
				.returning();
			for (const id of [foreign.id, other.id])
				await expect(
					recordPayment(
						ctx,
						v.parse(schemas.paymentInput, { customerId: customers[0], chargeId: id, amount: 100 })
					)
				).rejects.toMatchObject({ status: 404 });
			const own = await addCharge(
				ctx,
				v.parse(schemas.chargeInput, {
					customerId: customers[0],
					amount: 1000,
					dueDate: '2026-10-12'
				})
			);
			expect(
				(
					await recordPayment(
						ctx,
						v.parse(schemas.paymentInput, {
							customerId: customers[0],
							chargeId: own.id,
							amount: 100
						})
					)
				)[0].chargeId
			).toBe(own.id);
			expect(await db.select().from(payment).where(eq(payment.chargeId, foreign.id))).toHaveLength(
				0
			);
		});
		it('authorizes a job before adding custom billable materials', async () => {
			const material = { customName: 'Part', qty: 1, unitPrice: 100 };
			await expect(
				addMaterial(ctx, v.parse(schemas.jobMaterialInput, { ...material, jobId: jobs[1] }))
			).rejects.toMatchObject({ status: 404 });
			expect(
				await db.select().from(jobMaterial).where(eq(jobMaterial.jobId, jobs[1]))
			).toHaveLength(0);
			expect(
				(await addMaterial(ctx, v.parse(schemas.jobMaterialInput, { ...material, jobId: jobs[0] })))
					.jobId
			).toBe(jobs[0]);
		});
		it('returns only public company settings', async () => {
			await getSettings(orgs[0]);
			const { companySettings } = await import('#lib/server/db/schema.ts');
			await db
				.update(companySettings)
				.set({ publicPage: true })
				.where(eq(companySettings.organizationId, orgs[0]));
			const page = await getPublicCompany(orgs[0]);
			expect(page.settings).toHaveProperty('bookingEnabled');
			expect(page.settings).not.toHaveProperty('nextInvoiceNumber');
			expect(page.settings).not.toHaveProperty('organizationId');
		});
		it('validates quote-request locations before creating estimates', async () => {
			await db
				.update(customer)
				.set({ portalUserId: users[0] })
				.where(eq(customer.id, customers[0]));
			for (const location of [locations[1], locations[2]]) {
				await expect(
					requestService(
						orgs[0],
						users[0],
						v.parse(schemas.portalRequestInput, {
							customerId: customers[0],
							serviceLocationId: location,
							requestType: 'quote'
						})
					)
				).rejects.toMatchObject({ status: 404 });
			}
			const result = await requestService(
				orgs[0],
				users[0],
				v.parse(schemas.portalRequestInput, {
					customerId: customers[0],
					serviceLocationId: locations[0],
					requestType: 'quote'
				})
			);
			expect(result).toBeTruthy();
		});
		it('does not disclose existing customer records in public booking receipts', async () => {
			const result = await requestBooking(
				orgs[0],
				randomUUID(),
				v.parse(schemas.bookingInput, {
					name: 'Visitor',
					email: `${customers[0]}@example.invalid`,
					phone: '555-0100'
				})
			);
			expect(result).not.toHaveProperty('customer');
			expect(Object.keys(result.job).sort()).toEqual(['id', 'number', 'organizationId']);
			expect(result).not.toHaveProperty('notes');
		});
		it('ignores legacy foreign-tenant and foreign-customer payments in balances', async () => {
			const before = await customerBalance(orgs[0], customers[0]);
			const own = await addCharge(
				ctx,
				v.parse(schemas.chargeInput, {
					customerId: customers[0],
					amount: 700,
					description: 'Balance boundary',
					dueDate: '2026-01-01'
				})
			);
			await db.insert(payment).values([
				{ organizationId: orgs[1], customerId: customers[1], chargeId: own.id, amount: 600 },
				{ organizationId: orgs[0], customerId: customers[2], chargeId: own.id, amount: 500 }
			]);
			expect(await customerBalance(orgs[0], customers[0])).toBe(before + 700);
		});
	}
);
