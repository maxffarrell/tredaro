import p from 'postgres';
const sql = p(process.env.DATABASE_URL);
const org = 'hz1gL9KNhJhMSMjru5clugazRYeARvJQ';
console.log(
	'settings:',
	JSON.stringify(
		await sql`select estimate_valid_days from company_settings where organization_id=${org}`
	)
);
console.log(
	'notif rows for staff:',
	JSON.stringify(
		await sql`select recipient,count(*) from notification_log where organization_id=${org} group by recipient order by 2 desc limit 5`
	)
);
console.log(
	'open invoices due:',
	JSON.stringify(
		await sql`select i.number,i.due_date from invoice i where i.organization_id=${org} and i.status='open' order by i.due_date nulls last limit 8`
	)
);
console.log(
	'draft estimates:',
	JSON.stringify(
		await sql`select id,number from estimate where organization_id=${org} and status='draft' limit 3`
	)
);
await sql.end();
