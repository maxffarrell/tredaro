import { error } from '@sveltejs/kit';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { companySettings, office, organization } from '#lib/server/db/schema.ts';
import type { OrgContext } from '#lib/server/context.ts';
import type * as s from '#lib/schemas.ts';
import type * as v from 'valibot';

export async function getSettings(orgId: string) {
	const [row] = await db
		.select()
		.from(companySettings)
		.where(eq(companySettings.organizationId, orgId));
	const [org] = await db
		.select({ name: organization.name })
		.from(organization)
		.where(eq(organization.id, orgId));
	if (row) return { ...row, orgName: org?.name ?? '' };
	const [created] = await db
		.insert(companySettings)
		.values({ organizationId: orgId })
		.onConflictDoNothing()
		.returning();
	return { ...created!, orgName: org?.name ?? '' };
}

export async function updateSettings(
	ctx: OrgContext,
	input: v.InferOutput<typeof s.settingsInput>
) {
	await getSettings(ctx.orgId);
	await db
		.update(companySettings)
		.set({ ...input, updatedAt: new Date() })
		.where(eq(companySettings.organizationId, ctx.orgId));
	return getSettings(ctx.orgId);
}

/** Allocates the next human-readable document number for the workspace. */
export async function nextNumber(
	orgId: string,
	kind: 'job' | 'estimate' | 'invoice'
): Promise<number> {
	await getSettings(orgId);
	const set =
		kind === 'job'
			? { nextJobNumber: sql`${companySettings.nextJobNumber} + 1` }
			: kind === 'estimate'
				? { nextEstimateNumber: sql`${companySettings.nextEstimateNumber} + 1` }
				: { nextInvoiceNumber: sql`${companySettings.nextInvoiceNumber} + 1` };
	const col =
		kind === 'job'
			? companySettings.nextJobNumber
			: kind === 'estimate'
				? companySettings.nextEstimateNumber
				: companySettings.nextInvoiceNumber;
	const [row] = await db
		.update(companySettings)
		.set(set)
		.where(eq(companySettings.organizationId, orgId))
		.returning({ n: col });
	return row!.n - 1;
}

export async function listOffices(orgId: string, includeArchived = false) {
	return db
		.select()
		.from(office)
		.where(
			and(eq(office.organizationId, orgId), includeArchived ? undefined : isNull(office.archivedAt))
		)
		.orderBy(asc(office.name));
}

export async function createOffice(ctx: OrgContext, input: v.InferOutput<typeof s.officeInput>) {
	const [row] = await db
		.insert(office)
		.values({ organizationId: ctx.orgId, name: input.name, address: input.address })
		.returning();
	return row;
}

export async function updateOffice(ctx: OrgContext, input: v.InferOutput<typeof s.officeUpdate>) {
	const [row] = await db
		.update(office)
		.set({
			name: input.name,
			address: input.address,
			archivedAt: input.archived === undefined ? undefined : input.archived ? new Date() : null
		})
		.where(and(eq(office.organizationId, ctx.orgId), eq(office.id, input.id)))
		.returning();
	if (!row) error(404, 'Office not found');
	return row;
}
