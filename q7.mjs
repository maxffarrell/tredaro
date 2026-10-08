import p from 'postgres';
const sql = p(process.env.DATABASE_URL);
const org = 'hz1gL9KNhJhMSMjru5clugazRYeARvJQ';
// check drizzle's outer() rendering — what does ${invoice.id} inside subquery resolve to vs outer(invoice.id)? Look at how it's written
console.log(
	JSON.stringify(
		await sql`select column_name,data_type from information_schema.columns where table_name='invoice' and column_name in ('issued_at','status')`
	)
);
console.log(
	JSON.stringify(
		await sql`select count(*) from charge where invoice_id is not null and status!='void'`
	)
);
await sql.end();
