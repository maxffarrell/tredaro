import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
	agreementPlan,
	charge,
	customer,
	estimate,
	job,
	jobType,
	office,
	organization,
	payment,
	serviceAgreement,
	serviceLocation,
	outer
} from '/home/ubuntu/repos/tredaro/src/lib/server/db/schema.ts';

const client = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(client);
const [org] = await db.select().from(organization).limit(1);
const orgId = org!.id;
const id = '956d1855-35b7-47df-bfd5-ef6e5d3ed872';

const steps: [string, () => Promise<unknown>][] = [
	[
		'row',
		() =>
			db
				.select({ customer, officeName: office.name })
				.from(customer)
				.leftJoin(office, eq(customer.officeId, office.id))
				.where(and(eq(customer.organizationId, orgId), eq(customer.id, id)))
	],
	[
		'locations',
		() =>
			db
				.select()
				.from(serviceLocation)
				.where(and(eq(serviceLocation.organizationId, orgId), eq(serviceLocation.customerId, id)))
				.orderBy(desc(serviceLocation.isPrimary), asc(serviceLocation.label))
	],
	[
		'agreements',
		() =>
			db
				.select({
					agreement: serviceAgreement,
					planName: agreementPlan.name,
					amount: agreementPlan.amount,
					interval: agreementPlan.interval
				})
				.from(serviceAgreement)
				.innerJoin(agreementPlan, eq(serviceAgreement.planId, agreementPlan.id))
				.where(and(eq(serviceAgreement.organizationId, orgId), eq(serviceAgreement.customerId, id)))
				.orderBy(desc(serviceAgreement.createdAt))
	],
	[
		'jobs',
		() =>
			db
				.select({ job, jobTypeName: jobType.name, color: jobType.color })
				.from(job)
				.leftJoin(jobType, eq(job.jobTypeId, jobType.id))
				.where(and(eq(job.organizationId, orgId), eq(job.customerId, id)))
				.orderBy(desc(job.createdAt))
				.limit(50)
	],
	[
		'estimates',
		() =>
			db
				.select()
				.from(estimate)
				.where(and(eq(estimate.organizationId, orgId), eq(estimate.customerId, id)))
				.orderBy(desc(estimate.createdAt))
				.limit(50)
	],
	[
		'charges',
		() =>
			db
				.select({
					charge,
					paid: sql<number>`coalesce((select sum(p.amount) from ${payment} p where p.charge_id = ${outer(charge.id)}), 0)`.mapWith(
						Number
					)
				})
				.from(charge)
				.where(and(eq(charge.organizationId, orgId), eq(charge.customerId, id)))
				.orderBy(desc(charge.dueDate))
				.limit(50)
	],
	[
		'payments',
		() =>
			db
				.select()
				.from(payment)
				.where(and(eq(payment.organizationId, orgId), eq(payment.customerId, id)))
				.orderBy(desc(payment.paidAt))
				.limit(50)
	]
];

for (const [name, fn] of steps) {
	try {
		const r = await fn();
		console.log(name, 'OK', Array.isArray(r) ? r.length : '');
	} catch (e) {
		console.log(name, 'FAILED:', (e as Error).message);
	}
}
await client.end();
