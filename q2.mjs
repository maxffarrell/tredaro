import p from 'postgres';
const sql = p(process.env.DATABASE_URL);
console.log(
	JSON.stringify(
		await sql`select number,status from estimate where id='1d4d95c7-9e24-4bd2-94f4-5b4714ff1549'`
	)
);
console.log(
	JSON.stringify(
		await sql`select status,count(*) from estimate where organization_id='hz1gL9KNhJhMSMjru5clugazRYeARvJQ' group by status`
	)
);
await sql.end();
