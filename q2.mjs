import p from 'postgres';
const sql = p(process.env.DATABASE_URL);
const org = 'hz1gL9KNhJhMSMjru5clugazRYeARvJQ';
console.log(
	JSON.stringify(
		await sql`select kind,recipient,created_at from notification_log where organization_id=${org} and kind like '%sms%' order by created_at desc limit 3`
	)
);
await sql.end();
