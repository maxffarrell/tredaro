import p from 'postgres';
const sql = p(process.env.DATABASE_URL);
const org = 'hz1gL9KNhJhMSMjru5clugazRYeARvJQ';
const [s] = await sql`select * from company_settings where organization_id=${org}`;
console.log(JSON.stringify(s));
await sql.end();
