import p from 'postgres';
const sql = p(process.env.DATABASE_URL);
const org = 'hz1gL9KNhJhMSMjru5clugazRYeARvJQ';
const tech = 'LgutYQXzqWH5RsXRL8Wvivl23UHgSYkC';
console.log(
	'avg days:',
	JSON.stringify(
		await sql`select avg(extract(epoch from (completed_at-starts_at))/86400) d,count(*) n from job where organization_id=${org} and status='done' and completed_at>now()-interval '90 days'`
	)
);
console.log(
	'next job:',
	JSON.stringify(
		await sql`select number,status,starts_at::text from job where organization_id=${org} and technician_id=${tech} and starts_at::date=current_date and status<>'done' order by starts_at limit 3`
	)
);
console.log(
	'approved est:',
	JSON.stringify(
		await sql`select e.number, coalesce((select sum(ei.qty*ei.unit_price) from estimate_item ei where ei.estimate_id=e.id),0) tot from estimate e where e.organization_id=${org} and e.status='approved'`
	)
);
await sql.end();
