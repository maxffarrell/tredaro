import * as v from 'valibot';
import { error } from '@sveltejs/kit';
import { command, query } from '$app/server';
import { requireUser } from '#lib/server/context.ts';
import { db } from '#lib/server/db/index.ts';
import { customer } from '#lib/server/db/schema.ts';
import { and, eq } from 'drizzle-orm';
import * as svc from '#lib/server/services/portal.ts';
import { notifyStaffBooking } from '#lib/server/services/notifications.ts';
import { idSchema, portalContactInput, portalRequestInput } from '#lib/schemas.ts';

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
	const r = await svc.requestService(c.organizationId, user.id, {
		...input,
		customerId: c.id
	});
	if (r.job) {
		void notifyStaffBooking(c.organizationId, r.job.id).catch((err) =>
			console.error('staff booking alert failed', err)
		);
	} else if (r.estimate) {
		const { notifyStaffQuoteRequest } = await import('#lib/server/services/notifications.ts');
		void notifyStaffQuoteRequest(c.organizationId, r.estimate.id).catch((err) =>
			console.error('quote-request alert failed', err)
		);
	}
	void getPortalOverview(c.id).refresh();
	return r;
});

/** Customer rates a completed visit — 1-5 stars + optional note. */
export const rateVisit = command(
	v.object({
		customerId: idSchema,
		jobId: idSchema,
		rating: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(5)),
		note: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(1000)), '')
	}),
	async (input) => {
		const c = await myCustomer(input.customerId);
		const r = await svc.rateVisit(c.organizationId, c.id, input.jobId, input.rating, input.note);
		const { notifyVisitRated } = await import('#lib/server/services/notifications.ts');
		void notifyVisitRated(c.organizationId, input.jobId, input.rating).catch((err) =>
			console.error('visit-rated alert failed', err)
		);
		void getPortalOverview(c.id).refresh();
		return r;
	}
);

/** Customer confirms an upcoming visit — writes a 'confirmed' job event staff see on the timeline. */
export const confirmVisit = command(
	v.object({ customerId: idSchema, jobId: idSchema }),
	async (input) => {
		const c = await myCustomer(input.customerId);
		const r = await svc.confirmVisit(c.organizationId, c.id, input.jobId);
		void getPortalOverview(c.id).refresh();
		return r;
	}
);

/** Customer asks for a different time on an upcoming visit. */
export const requestReschedule = command(
	v.object({
		customerId: idSchema,
		jobId: idSchema,
		preferredTime: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200))
	}),
	async (input) => {
		const c = await myCustomer(input.customerId);
		const r = await svc.requestReschedule(c.organizationId, c.id, input.jobId, input.preferredTime);
		void getPortalOverview(c.id).refresh();
		return r;
	}
);

/** Portal self-service: customer updates their own email/phone. */
export const updatePortalContact = command(portalContactInput, async (input) => {
	const c = await myCustomer(input.customerId);
	const { user } = requireUser();
	const row = await svc.updatePortalContact(user.id, c.id, input);
	void getPortalOverview(c.id).refresh();
	return row;
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

/** Hosted setup page where the customer saves a card for automatic payments. */
export const saveCardOnFile = command(
	v.object({ customerId: idSchema, provider: v.string() }),
	async (input) => {
		const c = await myCustomer(input.customerId);
		return { url: await svc.portalSaveCard(c.id, input.provider) };
	}
);
