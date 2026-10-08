import p from 'postgres';
const sql = p(process.env.DATABASE_URL);
const org = 'hz1gL9KNhJhMSMjru5clugazRYeARvJQ';
await sql`update customer set office_id='c8879a96-7977-4429-83c9-8e9e4af8bd09' where organization_id=${org} and name in ('QA Lead Fresh','QA Unique Person')`;
console.log(
	JSON.stringify(
		await sql`select c.name, coalesce((select sum(ch.amount - coalesce((select sum(pa.amount) from payment pa where pa.charge_id=ch.id),0)) from charge ch where ch.customer_id=c.id and ch.status='open'),0) bal from customer c where c.name in ('QA Lead Fresh','QA Unique Person')`
	)
);
await sql.end();
