import p from 'postgres';
const sql = p(process.env.DATABASE_URL);
const org = 'hz1gL9KNhJhMSMjru5clugazRYeARvJQ';
console.log(
	JSON.stringify(
		await sql`select o.name,count(*) n from customer c join office o on o.id=c.office_id where c.organization_id=${org} group by o.name`
	)
);
await sql.end();
