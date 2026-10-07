import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { portalCustomers } from '#lib/server/services/customers.ts';

export const load: PageServerLoad = async ({ locals, url }) => {
	const companies = await portalCustomers(locals.user!.id);
	if (!companies.length)
		error(
			404,
			'No customer profile is linked to this account yet — ask your service company for a portal link.'
		);
	const options = companies.map((c) => ({ customerId: c.customer.id, companyName: c.orgName }));
	const customerId = url.searchParams.get('c') ?? companies[0]!.customer.id;
	return { options, customerId };
};
