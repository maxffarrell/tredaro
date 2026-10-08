import { error } from '@sveltejs/kit';
import { and, asc, desc, eq, gte, ilike, inArray, or, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	activity,
	agreementPlan,
	charge,
	customer,
	equipment,
	invoice,
	job,
	jobType,
	notificationLog,
	office,
	organization,
	payment,
	serviceAgreement,
	serviceLocation,
	estimate,
	outer
} from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import { emit } from './events.ts';
import type * as s from '#lib/schemas.ts';
import type * as v from 'valibot';

export async function listCustomers(orgId: string, q?: string) {
	const term = q?.trim();
	return db
		.select({
			id: customer.id,
			name: customer.name,
			companyName: customer.companyName,
			type: customer.type,
			email: customer.email,
			phone: customer.phone,
			status: customer.status,
			since: customer.since,
			tags: customer.tags,
			preferredMemberId: customer.preferredMemberId,
			officeId: customer.officeId,
			portalLinked: sql<boolean>`${customer.portalUserId} is not null`.mapWith(Boolean),
			onHold: customer.onHold,
			leadSource: customer.leadSource,
			officeName: office.name,
			openBalance:
				sql<number>`coalesce((select sum(c.amount - coalesce((select sum(p.amount) from ${payment} p where p.charge_id = c.id), 0)) from ${charge} c where c.customer_id = ${outer(customer.id)} and c.status = 'open'), 0)`.mapWith(
					Number
				),
			hasAgreement:
				sql<boolean>`exists (select 1 from ${serviceAgreement} a where a.customer_id = ${outer(customer.id)} and a.status = 'active')`.mapWith(
					Boolean
				),
			hasUpcoming:
				sql<boolean>`exists (select 1 from ${job} j where j.customer_id = ${outer(customer.id)} and j.status in ('scheduled', 'dispatched', 'in_progress') and j.starts_at > now())`.mapWith(
					Boolean
				),
			lastVisit: sql<
				string | null
			>`(select max(j.completed_at)::text from job j where j.customer_id = ${outer(customer.id)} and j.status = 'done')`,
			planName: sql<
				string | null
			>`(select p2.name from ${serviceAgreement} a2 join ${agreementPlan} p2 on p2.id = a2.plan_id where a2.customer_id = ${outer(customer.id)} and a2.status = 'active' order by a2.created_at desc limit 1)`
		})
		.from(customer)
		.leftJoin(office, eq(customer.officeId, office.id))
		.where(
			and(
				eq(customer.organizationId, orgId),
				term
					? or(
							ilike(customer.name, `%${term}%`),
							ilike(customer.companyName, `%${term}%`),
							ilike(customer.email, `%${term}%`),
							ilike(customer.phone, `%${term}%`),
							sql`exists (select 1 from ${equipment} e where e.customer_id = ${customer.id} and e.organization_id = ${orgId} and (e.serial ilike ${`%${term}%`} or e.model ilike ${`%${term}%`} or e.name ilike ${`%${term}%`} or e.brand ilike ${`%${term}%`}))`
						)
					: undefined
			)
		)
		.orderBy(asc(customer.name));
}

export async function getCustomer(orgId: string, id: string) {
	const [row] = await db
		.select({ customer, officeName: office.name })
		.from(customer)
		.leftJoin(office, eq(customer.officeId, office.id))
		.where(and(eq(customer.organizationId, orgId), eq(customer.id, id)));
	if (!row) error(404, 'Customer not found');

	const locations = await db
		.select()
		.from(serviceLocation)
		.where(and(eq(serviceLocation.organizationId, orgId), eq(serviceLocation.customerId, id)))
		.orderBy(desc(serviceLocation.isPrimary), asc(serviceLocation.label));

	const agreements = await db
		.select({
			agreement: serviceAgreement,
			planName: agreementPlan.name,
			amount: agreementPlan.amount,
			interval: agreementPlan.interval
		})
		.from(serviceAgreement)
		.innerJoin(agreementPlan, eq(serviceAgreement.planId, agreementPlan.id))
		.where(and(eq(serviceAgreement.organizationId, orgId), eq(serviceAgreement.customerId, id)))
		.orderBy(desc(serviceAgreement.createdAt));

	const jobs = await db
		.select({ job, jobTypeName: jobType.name, color: jobType.color })
		.from(job)
		.leftJoin(jobType, eq(job.jobTypeId, jobType.id))
		.where(and(eq(job.organizationId, orgId), eq(job.customerId, id)))
		.orderBy(desc(job.createdAt))
		.limit(50);

	const estimates = await db
		.select()
		.from(estimate)
		.where(and(eq(estimate.organizationId, orgId), eq(estimate.customerId, id)))
		.orderBy(desc(estimate.createdAt))
		.limit(50);

	const [nextJob] = await db
		.select({ job, jobTypeName: jobType.name })
		.from(job)
		.leftJoin(jobType, eq(job.jobTypeId, jobType.id))
		.where(
			and(
				eq(job.organizationId, orgId),
				eq(job.customerId, id),
				gte(job.startsAt, new Date()),
				sql`${job.status} in ('scheduled', 'dispatched', 'in_progress')`
			)
		)
		.orderBy(asc(job.startsAt))
		.limit(1);

	const charges = await db
		.select({
			charge,
			paid: sql<number>`coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${outer(charge.id)}), 0)`.mapWith(
				Number
			)
		})
		.from(charge)
		.where(and(eq(charge.organizationId, orgId), eq(charge.customerId, id)))
		.orderBy(desc(charge.dueDate))
		.limit(50);

	const payments = await db
		.select()
		.from(payment)
		.where(and(eq(payment.organizationId, orgId), eq(payment.customerId, id)))
		.orderBy(desc(payment.paidAt))
		.limit(50);

	const equipmentRows = await listEquipment(orgId, id);

	// Lifetime rollups (full history, not the 50-row lists above).
	const [stats] = await db
		.select({
			jobCount: sql<number>`count(*)`.mapWith(Number)
		})
		.from(job)
		.where(
			and(eq(job.organizationId, orgId), eq(job.customerId, id), sql`${job.status} != 'cancelled'`)
		);
	const [money] = await db
		.select({
			invoiced: sql<number>`coalesce(sum(${charge.amount}), 0)`.mapWith(Number),
			collected:
				sql<number>`coalesce((select sum(p.amount) from ${payment} p join ${charge} c2 on p.charge_id = c2.id where c2.customer_id = ${id} and c2.organization_id = ${orgId}), 0)`.mapWith(
					Number
				)
		})
		.from(charge)
		.where(
			and(
				eq(charge.organizationId, orgId),
				eq(charge.customerId, id),
				sql`${charge.status} != 'void'`
			)
		);

	// Every automated email/SMS we logged a send for, addressed to this
	// customer's email or phone — a lightweight comms history for the CRM.
	const recipients = [row.customer.email, row.customer.phone].filter((r): r is string =>
		Boolean(r)
	);
	const communications = recipients.length
		? await db
				.select()
				.from(notificationLog)
				.where(
					and(
						eq(notificationLog.organizationId, orgId),
						or(
							inArray(notificationLog.recipient, recipients),
							// Some sends dedupe on a composite key like `phone:renewsOn`.
							...recipients.map((r) => ilike(notificationLog.recipient, `${r}:%`))
						)
					)
				)
				.orderBy(desc(notificationLog.createdAt))
				.limit(25)
		: [];

	return {
		...row,
		locations,
		agreements,
		jobs,
		estimates,
		charges,
		communications,
		payments,
		equipment: equipmentRows,
		nextJob,
		stats: { jobCount: stats.jobCount, invoiced: money.invoiced, collected: money.collected }
	};
}

export async function createCustomer(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.customerInput>
) {
	const [row] = await db
		.insert(customer)
		.values({
			organizationId: ctx.orgId,
			type: input.type,
			companyName: input.companyName ?? null,
			name: input.name,
			email: input.email || null,
			phone: input.phone ?? null,
			officeId: input.officeId ?? null,
			status: input.status,
			notes: input.notes ?? null,
			since: input.since ?? null,
			tags: input.tags,
			smsOptOut: input.smsOptOut,
			emailOptOut: input.emailOptOut,
			leadSource: input.leadSource ?? null,
			onHold: input.onHold,
			taxExempt: input.taxExempt,
			preferredMemberId: input.preferredMemberId ?? null
		})
		.returning();
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'customer',
		entityId: row!.id,
		action: 'created',
		summary: `${input.name} added as a customer`
	});
	return row;
}

/** Bulk-creates customers from CSV rows; skips rows whose email already belongs to a customer (or is repeated). */
export async function importCustomers(
	ctx: OrgContext,
	rows: v.InferOutput<typeof s.customerImportInput>
) {
	const emails = rows.map((r) => r.email?.toLowerCase()).filter((e): e is string => !!e);
	const taken = new Set(
		emails.length
			? (
					await db
						.select({ email: sql<string>`lower(${customer.email})` })
						.from(customer)
						.where(
							and(
								eq(customer.organizationId, ctx.orgId),
								inArray(sql`lower(${customer.email})`, emails)
							)
						)
				).map((r) => r.email)
			: []
	);
	const seen = new Set<string>();
	const toInsert = rows.filter((r) => {
		const e = r.email?.toLowerCase();
		if (!e) return true;
		if (taken.has(e) || seen.has(e)) return false;
		seen.add(e);
		return true;
	});
	if (toInsert.length)
		await db.insert(customer).values(
			toInsert.map((r) => ({
				organizationId: ctx.orgId,
				name: r.name,
				email: r.email || null,
				phone: r.phone ?? null
			}))
		);
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'customer',
		entityId: 'csv-import',
		action: 'imported',
		summary: `Imported ${toInsert.length} customer${toInsert.length === 1 ? '' : 's'}`,
		data: { skipped: rows.length - toInsert.length }
	});
	return { created: toInsert.length, skipped: rows.length - toInsert.length };
}

/** Detaches the customer's portal login — the claim link can re-link a new account later. */
export async function revokePortalAccess(ctx: OrgContext, customerId: string) {
	const [row] = await db
		.update(customer)
		.set({ portalUserId: null })
		.where(and(eq(customer.organizationId, ctx.orgId), eq(customer.id, customerId)))
		.returning({ id: customer.id, name: customer.name });
	if (!row) error(404, 'Customer not found');
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'customer',
		entityId: row.id,
		action: 'portal_revoked',
		summary: `Portal access revoked for ${row.name}`
	});
	return row;
}

export async function updateCustomer(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.customerUpdate>
) {
	const { id, ...set } = input;
	const [row] = await db
		.update(customer)
		.set({
			type: set.type,
			companyName: set.companyName,
			name: set.name,
			email: set.email === undefined ? undefined : set.email || null,
			phone: set.phone,
			officeId: set.officeId,
			status: set.status,
			notes: set.notes,
			since: set.since,
			tags: set.tags,
			smsOptOut: set.smsOptOut,
			emailOptOut: set.emailOptOut,
			leadSource: set.leadSource === undefined ? undefined : set.leadSource || null,
			onHold: set.onHold,
			taxExempt: set.taxExempt,
			preferredMemberId:
				set.preferredMemberId === undefined ? undefined : set.preferredMemberId || null
		})
		.where(and(eq(customer.organizationId, ctx.orgId), eq(customer.id, id)))
		.returning();
	if (!row) error(404, 'Customer not found');
	return row;
}

// ---------- Service locations ----------

export async function addServiceLocation(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.serviceLocationInput>
) {
	const [c] = await db
		.select({ id: customer.id })
		.from(customer)
		.where(and(eq(customer.organizationId, ctx.orgId), eq(customer.id, input.customerId)));
	if (!c) error(404, 'Customer not found');
	const [{ count }] = await db
		.select({ count: sql<number>`count(*)`.mapWith(Number) })
		.from(serviceLocation)
		.where(
			and(
				eq(serviceLocation.organizationId, ctx.orgId),
				eq(serviceLocation.customerId, input.customerId)
			)
		);
	const [row] = await db
		.insert(serviceLocation)
		.values({
			organizationId: ctx.orgId,
			customerId: input.customerId,
			label: input.label,
			address1: input.address1,
			city: input.city,
			state: input.state,
			zip: input.zip,
			accessNotes: input.accessNotes,
			isPrimary: input.isPrimary || count === 0
		})
		.returning();
	return row;
}

export async function updateServiceLocation(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.serviceLocationUpdate>
) {
	const { id, ...set } = input;
	const [row] = await db
		.update(serviceLocation)
		.set(set)
		.where(and(eq(serviceLocation.organizationId, ctx.orgId), eq(serviceLocation.id, id)))
		.returning();
	if (!row) error(404, 'Service location not found');
	return row;
}

// ---------- Equipment ----------

/** A customer's installed equipment, with location label and last service date. */
export async function listEquipment(orgId: string, customerId?: string) {
	return db
		.select({
			equipment,
			customerName: customer.name,
			locationLabel: serviceLocation.label,
			locationAddress: serviceLocation.address1,
			lastService: sql<
				string | null
			>`(select max(j.completed_at) from ${job} j where j.equipment_id = ${outer(equipment.id)})`,
			serviceCount:
				sql<number>`(select count(*) from ${job} j where j.equipment_id = ${outer(equipment.id)} and j.status = 'done' and j.cancelled_at is null)`.mapWith(
					Number
				)
		})
		.from(equipment)
		.innerJoin(customer, eq(equipment.customerId, customer.id))
		.leftJoin(serviceLocation, eq(equipment.serviceLocationId, serviceLocation.id))
		.where(
			and(
				eq(equipment.organizationId, orgId),
				customerId ? eq(equipment.customerId, customerId) : undefined
			)
		)
		.orderBy(desc(equipment.active), asc(equipment.name));
}

export async function getEquipment(orgId: string, id: string) {
	const [row] = await db
		.select({
			equipment,
			customerName: customer.name,
			locationLabel: serviceLocation.label,
			locationAddress: serviceLocation.address1
		})
		.from(equipment)
		.innerJoin(customer, eq(equipment.customerId, customer.id))
		.leftJoin(serviceLocation, eq(equipment.serviceLocationId, serviceLocation.id))
		.where(and(eq(equipment.organizationId, orgId), eq(equipment.id, id)));
	if (!row) error(404, 'Equipment not found');
	return row;
}

export async function createEquipment(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.equipmentInput>
) {
	const [c] = await db
		.select({ id: customer.id, name: customer.name })
		.from(customer)
		.where(and(eq(customer.organizationId, ctx.orgId), eq(customer.id, input.customerId)));
	if (!c) error(404, 'Customer not found');
	if (input.serviceLocationId) {
		const [loc] = await db
			.select({ id: serviceLocation.id })
			.from(serviceLocation)
			.where(
				and(
					eq(serviceLocation.organizationId, ctx.orgId),
					eq(serviceLocation.id, input.serviceLocationId),
					eq(serviceLocation.customerId, input.customerId)
				)
			);
		if (!loc) error(404, 'Service location not found');
	}
	const [row] = await db
		.insert(equipment)
		.values({
			organizationId: ctx.orgId,
			customerId: input.customerId,
			serviceLocationId: input.serviceLocationId ?? null,
			name: input.name,
			category: input.category,
			brand: input.brand,
			model: input.model,
			serial: input.serial,
			installedOn: input.installedOn ?? null,
			warrantyUntil: input.warrantyUntil ?? null,
			nextServiceDue: input.nextServiceDue ?? null,
			notes: input.notes,
			active: input.active
		})
		.returning();
	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'equipment',
		entityId: row!.id,
		action: 'created',
		summary: `${input.name} added for ${c.name}`
	});
	return row;
}

export async function updateEquipment(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.equipmentUpdate>
) {
	const { id, ...set } = input;
	const [row] = await db
		.update(equipment)
		.set(set)
		.where(and(eq(equipment.organizationId, ctx.orgId), eq(equipment.id, id)))
		.returning();
	if (!row) error(404, 'Equipment not found');
	return row;
}

/** Customers whose portal login is this user — one user can belong to several companies. */
export async function portalCustomers(userId: string) {
	return db
		.select({ customer, orgName: organization.name, orgSlug: organization.slug })
		.from(customer)
		.innerJoin(organization, eq(organization.id, customer.organizationId))
		.where(eq(customer.portalUserId, userId));
}

const normText = (s: string | null) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const digits = (s: string | null) => (s ?? '').replace(/\D/g, '');

/** Other customers that look like the same person — same email, phone digits, or name. */
export async function findDuplicates(orgId: string, customerId: string) {
	const all = await db
		.select({
			id: customer.id,
			name: customer.name,
			companyName: customer.companyName,
			email: customer.email,
			phone: customer.phone,
			status: customer.status
		})
		.from(customer)
		.where(eq(customer.organizationId, orgId));
	const me = all.find((c) => c.id === customerId);
	if (!me) return [];
	return all
		.filter((c) => c.id !== customerId)
		.flatMap((c) => {
			const match =
				me.email && c.email && normText(me.email) === normText(c.email)
					? ('same email' as const)
					: digits(me.phone).length >= 7 && digits(me.phone) === digits(c.phone)
						? ('same phone' as const)
						: normText(me.name) === normText(c.name)
							? ('same name' as const)
							: null;
			return match ? [{ customer: c, match }] : [];
		});
}

/** Customers matching a not-yet-saved record's email/phone/name — for create-time warnings. */
export async function findPotentialDuplicates(
	orgId: string,
	fields: { name?: string; email?: string; phone?: string }
) {
	const all = await db
		.select({
			id: customer.id,
			name: customer.name,
			companyName: customer.companyName,
			email: customer.email,
			phone: customer.phone,
			status: customer.status
		})
		.from(customer)
		.where(eq(customer.organizationId, orgId));
	return all.flatMap((c) => {
		const match =
			fields.email && c.email && normText(fields.email) === normText(c.email)
				? ('same email' as const)
				: digits(fields.phone ?? '').length >= 7 && digits(fields.phone ?? '') === digits(c.phone)
					? ('same phone' as const)
					: fields.name && normText(fields.name) === normText(c.name)
						? ('same name' as const)
						: null;
		return match ? [{ customer: c, match }] : [];
	});
}

/**
 * Merge `sourceId` into `targetId`: every record pointing at the duplicate moves to the
 * survivor, blank fields on the survivor fill from the duplicate, and the duplicate is
 * deleted. Runs in one transaction so a failure leaves both customers intact.
 */
export async function mergeCustomers(ctx: OrgContext, sourceId: string, targetId: string) {
	if (sourceId === targetId) error(400, 'Pick two different customers');
	const [target] = await db
		.select()
		.from(customer)
		.where(and(eq(customer.id, targetId), eq(customer.organizationId, ctx.orgId)))
		.limit(1);
	const [source] = await db
		.select()
		.from(customer)
		.where(and(eq(customer.id, sourceId), eq(customer.organizationId, ctx.orgId)))
		.limit(1);
	if (!target || !source) error(404, 'Customer not found');

	await db.transaction(async (tx) => {
		for (const t of [equipment, serviceAgreement, job, estimate, invoice, charge, payment] as const)
			await tx
				.update(t)
				.set({ customerId: targetId })
				.where(and(eq(t.customerId, sourceId), eq(t.organizationId, ctx.orgId)));

		// Locations move too — but only one primary may survive. If the survivor already
		// has one, the incoming locations lose theirs.
		const targetHasPrimary =
			(
				await tx
					.select({ id: serviceLocation.id })
					.from(serviceLocation)
					.where(
						and(
							eq(serviceLocation.organizationId, ctx.orgId),
							eq(serviceLocation.customerId, targetId),
							eq(serviceLocation.isPrimary, true)
						)
					)
					.limit(1)
			).length > 0;
		await tx
			.update(serviceLocation)
			.set({ customerId: targetId, ...(targetHasPrimary ? { isPrimary: false } : {}) })
			.where(
				and(eq(serviceLocation.customerId, sourceId), eq(serviceLocation.organizationId, ctx.orgId))
			);

		// Fill gaps on the survivor from the duplicate; the survivor's own values always win.
		await tx
			.update(customer)
			.set({
				officeId: target.officeId ?? source.officeId,
				portalUserId: target.portalUserId ?? source.portalUserId,
				companyName: target.companyName ?? source.companyName,
				email: target.email ?? source.email,
				phone: target.phone ?? source.phone,
				notes: target.notes ?? source.notes,
				since: target.since ?? source.since,
				updatedAt: new Date()
			})
			.where(eq(customer.id, targetId));

		// Keep the audit trail — the duplicate's activity reads as the survivor's.
		await tx
			.update(activity)
			.set({ entityId: targetId })
			.where(
				and(
					eq(activity.entityType, 'customer'),
					eq(activity.entityId, sourceId),
					eq(activity.organizationId, ctx.orgId)
				)
			);

		await tx
			.delete(customer)
			.where(and(eq(customer.id, sourceId), eq(customer.organizationId, ctx.orgId)));
	});

	await emit({
		orgId: ctx.orgId,
		actorId: ctx.userId,
		entityType: 'customer',
		entityId: targetId,
		action: 'merged',
		summary: `Merged ${source.name} into ${target.name}`,
		data: { sourceId }
	});
	return target;
}
