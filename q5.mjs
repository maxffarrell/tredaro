import p from 'postgres';
const sql = p(process.env.DATABASE_URL);
const org = 'hz1gL9KNhJhMSMjru5clugazRYeARvJQ';
// replicate: avg over invoices issued 90d of sum(charge.amount non-void per invoice)
console.log(
	JSON.stringify(
		await sql`select count(*) n, avg((select coalesce(sum(c.amount),0) from charge c where c.invoice_id=i.id and c.status!='void')) a from invoice i where i.organization_id=${org} and i.issued_at >= now() - interval '90 days'`
	)
);
console.log(
	'invoice_item-based:',
	JSON.stringify(
		await sql`select avg(t.tot) a,count(*) n from invoice i join (select invoice_id,sum(qty*unit_price) tot from invoice_item group by invoice_id) t on t.invoice_id=i.id where i.organization_id=${org} and i.issued_at>now()-interval '90 days'`
	)
);
await sql.end();
