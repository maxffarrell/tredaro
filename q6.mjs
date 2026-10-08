import p from 'postgres';
const sql = p(process.env.DATABASE_URL);
const org = 'hz1gL9KNhJhMSMjru5clugazRYeARvJQ';
console.log(
	JSON.stringify(
		await sql`select count(*) n, avg((select coalesce(sum(c.amount),0) from charge c where c.invoice_id=i.id and c.status!='void')) a from invoice i where i.organization_id=${org} and i.status='open' and i.issued_at >= now() - interval '90 days'`
	)
);
console.log(
	'statuses:',
	JSON.stringify(
		await sql`select status,count(*) from invoice where organization_id=${org} and issued_at>now()-interval '90 days' group by status`
	)
);
await sql.end();
