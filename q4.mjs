import p from 'postgres';
const sql = p(process.env.DATABASE_URL);
console.log(
	JSON.stringify(
		await sql`select number,status,sent_at,valid_until from estimate where id='1d4d95c7-9e24-4bd2-94f4-5b4714ff1549'`
	)
);
await sql.end();
