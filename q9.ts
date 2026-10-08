import { drizzle } from 'drizzle-orm/postgres-js';
import pg from 'postgres';
import { sql, and, eq, gte } from 'drizzle-orm';
import * as schema from './src/lib/server/db/schema.ts';
const client = pg(process.env.DATABASE_URL);
const db = drizzle(client, { schema });
const { invoice, charge } = schema;
const orgId = 'hz1gL9KNhJhMSMjru5clugazRYeARvJQ';
const q = db
	.select({
		n: sql`count(*)`.mapWith(Number),
		avg: sql`avg((select coalesce(sum(c.amount), 0) from ${charge} c where c.invoice_id = ${invoice.id} and c.status != 'void'))`.mapWith(
			Number
		)
	})
	.from(invoice)
	.where(
		and(
			eq(invoice.organizationId, orgId),
			eq(invoice.status, 'open'),
			gte(invoice.issuedAt, new Date(Date.now() - 90 * 86400_000))
		)
	);
console.log(q.toSQL().sql);
console.log(JSON.stringify(q.toSQL().params));
process.exit(0);
