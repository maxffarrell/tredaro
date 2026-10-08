import p from 'postgres';
const sql = p(process.env.DATABASE_URL);
const org = 'hz1gL9KNhJhMSMjru5clugazRYeARvJQ';
console.log(
	'staff sms rows:',
	JSON.stringify(
		await sql`select id,kind,entity_id,recipient from notification_log where organization_id=${org} and kind='inbound_sms_staff' limit 3`
	)
);
console.log(
	'staff email:',
	JSON.stringify(
		await sql`select u.email from member m join "user" u on u.id=m.user_id where m.id='LgutYQXzqWH5RsXRL8Wvivl23UHgSYkC'`
	)
);
console.log(
	'offices:',
	JSON.stringify(await sql`select * from office where organization_id=${org}`)
);
console.log(
	'avg invoice:',
	JSON.stringify(
		await sql`select count(*) n, avg(t.tot) a from invoice i join (select invoice_id,sum(qty*unit_price) tot from invoice_item group by invoice_id) t on t.invoice_id=i.id where i.organization_id=${org} and i.issued_at>now()-interval '90 days'`
	)
);
console.log(
	'cust office col:',
	JSON.stringify(
		await sql`select column_name from information_schema.columns where table_name='customer' and column_name like '%office%'`
	)
);
await sql.end();
