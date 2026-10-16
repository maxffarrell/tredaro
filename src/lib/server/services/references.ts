import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { PgTable, AnyPgColumn } from 'drizzle-orm/pg-core';
import { db, type DB } from '#lib/server/db/index.ts';
import {
	customer,
	equipment,
	jobType,
	pricebookItem,
	member,
	office,
	serviceLocation
} from '#lib/server/db/schema.ts';

type OwnedTable = PgTable & {
	id: AnyPgColumn;
	organizationId: AnyPgColumn;
	customerId?: AnyPgColumn;
};

/** Authorize the referenced record, not just the record containing its foreign key. */
export async function assertReference(
	orgId: string,
	table: OwnedTable,
	id: string | null | undefined,
	customerId?: string,
	q: Pick<DB, 'select'> = db
) {
	if (!id) return;
	if (customerId && !table.customerId) throw new Error('Customer relationship is unsupported');
	const [record] = await q
		.select({ id: table.id })
		.from(table)
		.where(
			and(
				eq(table.id, id),
				eq(table.organizationId, orgId),
				customerId && table.customerId ? eq(table.customerId, customerId) : undefined
			)
		)
		.limit(1);
	if (!record) error(404, 'Referenced record not found');
}

type JobReferences = {
	customerId: string;
	serviceLocationId?: string | null;
	equipmentId?: string | null;
	jobTypeId?: string | null;
	officeId?: string | null;
	technicianId?: string | null;
	helperId?: string | null;
};
export async function assertJobReferences(
	orgId: string,
	input: JobReferences,
	q: Pick<DB, 'select'> = db
) {
	await Promise.all([
		assertReference(orgId, customer, input.customerId, undefined, q),
		assertReference(orgId, serviceLocation, input.serviceLocationId, input.customerId, q),
		assertReference(orgId, equipment, input.equipmentId, input.customerId, q),
		assertReference(orgId, jobType, input.jobTypeId, undefined, q),
		assertReference(orgId, office, input.officeId, undefined, q),
		assertReference(orgId, member, input.technicianId, undefined, q),
		assertReference(orgId, member, input.helperId, undefined, q)
	]);
}

/** Validate linked catalog IDs before any estimate/invoice mutation. */
export async function assertPricebookItems(
	orgId: string,
	items: { pricebookItemId?: string | null }[],
	q: Pick<DB, 'select'> = db
) {
	for (const id of new Set(items.map((i) => i.pricebookItemId).filter(Boolean)))
		await assertReference(orgId, pricebookItem, id, undefined, q);
}
