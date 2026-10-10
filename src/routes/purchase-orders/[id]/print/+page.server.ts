import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getOrg } from '#lib/server/context.ts';
import { hasPortalCustomer } from '#lib/server/services/portal.ts';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
	const org = await getOrg();
	if (!org) {
		if (await hasPortalCustomer(locals.user.id)) redirect(303, '/portal');
		redirect(303, '/onboarding');
	}
};
