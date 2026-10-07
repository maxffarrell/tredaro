import * as v from 'valibot';
import { error } from '@sveltejs/kit';
import { command, query } from '$app/server';
import { requireUser } from '#lib/server/context.ts';
import { db } from '#lib/server/db/index.ts';
import { customer } from '#lib/server/db/schema.ts';
import { and, eq } from 'drizzle-orm';
import * as svc from '#lib/server/services/portal.ts';
import { idSchema, portalRequestInput } from '#lib/schemas.ts';

/** Resolves the customer record the signed-in user is acting as, and checks it belongs to them. */
async function myCustomer(customerId: string) {
	const { user } = requireUser();
	const [c] = await db
		.select()
		.from(customer)
		.where(and(eq(customer.id, customerId), eq(customer.portalUserId, user.id)));
	if (!c) error(403, 'Not your customer record');
	return c;
}

export const getPortalOverview = query(idSchema, async (customerId) => {
	const c = await myCustomer(customerId);
	return svc.portalOverview(c.id);
});

/** Customer requests work from the portal — lands in the unscheduled queue. */
export const requestService = command(portalRequestInput, async (input) => {
	const c = await myCustomer(input.customerId);
	const { user } = requireUser();
	const j = await svc.requestService(c.organizationId, user.id, {
		...input,
		customerId: c.id
	});
	void getPortalOverview(c.id).refresh();
	return j;
});

export const getProviders = query(idSchema, async (customerId) => {
	const c = await myCustomer(customerId);
	const overview = await svc.portalOverview(c.id);
	return svc.availableProviders(c.organizationId, overview.settings?.currency ?? 'usd');
});

export const startCheckout = command(
	v.object({ customerId: idSchema, provider: v.string() }),
	async ({ customerId, provider }) => {
		const c = await myCustomer(customerId);
		return { url: await svc.portalCheckout(c.id, provider) };
	}
);
