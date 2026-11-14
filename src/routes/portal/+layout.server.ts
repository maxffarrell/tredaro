import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { syncIfStale } from '#lib/server/profile/client.ts';
import { isDemo } from '#lib/server/demo-mode.ts';

export const load: LayoutServerLoad = ({ locals, url }) => {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
	void syncIfStale(locals.user.id);
	return {
		demo: isDemo(),
		demoExpiresAt: isDemo() ? (locals.session?.expiresAt.getTime() ?? null) : null,
		demoServerNow: Date.now(),
		user: { name: locals.user.name, email: locals.user.email }
	};
};
