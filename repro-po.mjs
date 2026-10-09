import { purchaseOrder } from './src/lib/server/db/schema.ts';
import { and, eq, inArray, isNull, count, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
const orgId='EmhHCKpWrmON5jlFZyKF1SeGKKKpmBEt';
const db = drizzle.mock();
const sel = db.select({
  n: count(),
  total: sql`coalesce(sum((select sum(i.qty * i.unit_cost) from purchase_order_item i where i.purchase_order_id = ${purchaseOrder.id})), 0)`.mapWith(Number)
}).from(purchaseOrder).where(and(eq(purchaseOrder.organizationId,orgId),inArray(purchaseOrder.status,['ordered','received']),isNull(purchaseOrder.paidAt)));
console.log(sel.toSQL().sql);
console.log('params:',sel.toSQL().params);
process.exit(0);
