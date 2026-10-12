import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { PgTable, AnyPgColumn } from 'drizzle-orm/pg-core';
import { db, type DB } from '#lib/server/db/index.ts';
import {
	customer,
	equipment,
	jobType,
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
export async function assertJobReferences(orgId: string, input: JobReferences) {
	await Promise.all([
		assertReference(orgId, customer, input.customerId),
		assertReference(orgId, serviceLocation, input.serviceLocationId, input.customerId),
		assertReference(orgId, equipment, input.equipmentId, input.customerId),
		assertReference(orgId, jobType, input.jobTypeId),
		assertReference(orgId, office, input.officeId),
		assertReference(orgId, member, input.technicianId),
		assertReference(orgId, member, input.helperId)
	]);
}
