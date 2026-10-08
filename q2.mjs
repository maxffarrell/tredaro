import p from 'postgres';
const sql = p(process.env.DATABASE_URL);
const org = 'hz1gL9KNhJhMSMjru5clugazRYeARvJQ';
console.log(
	JSON.stringify(
		await sql`select estimate_valid_days from company_settings where organization_id=${org}`
	)
);
await sql.end();
