import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { syncIfStale } from '#lib/server/profile/client.ts';

export const load: LayoutServerLoad = ({ locals, url }) => {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
	void syncIfStale(locals.user.id);
	return { user: { name: locals.user.name, email: locals.user.email } };
};
