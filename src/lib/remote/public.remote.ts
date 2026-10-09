import * as v from 'valibot';
import { command, getRequestEvent, query } from '$app/server';
import { bookingInput, estimateDecisionInput } from '#lib/schemas.ts';
import {
	getPublicCompany,
	requestBooking,
	setVisitPreference
} from '#lib/server/services/public.ts';
import {
	notifyBookingConfirmationSms,
	notifyBookingReceived,
	notifyStaffBooking,
	notifyStaffEstimateChanges,
	notifyStaffEstimateDecision
} from '#lib/server/services/notifications.ts';
import {
	decideEstimate,
	publicEstimate,
	requestEstimateChanges,
	verifyEstimateToken
} from '#lib/server/services/estimates.ts';
import { publicInvoiceCheckout } from '#lib/server/services/billing.ts';
import { error } from '@sveltejs/kit';

function clientIp() {
	try {
		return getRequestEvent().getClientAddress();
	} catch {
		return 'unknown';
	}
}

/** Public company page data for /book/[slug] — unauthenticated by design. */
export const getBookingPage = query(v.string(), async (slug) => getPublicCompany(slug));

/** Public booking form — rate-limited + honeypot inside. */
export const requestBookingForm = command(
	v.object({ slug: v.string(), input: bookingInput }),
	async ({ slug, input }) => {
		const r = await requestBooking(slug, clientIp(), input);
		void notifyBookingReceived(r.job!.organizationId, r.job!.id).catch((err) =>
			console.error('booking email failed', err)
		);
		void notifyStaffBooking(r.job!.organizationId, r.job!.id).catch((err) =>
			console.error('staff booking alert failed', err)
		);
		void notifyBookingConfirmationSms(r.job!.organizationId, r.job!.id).catch((err) =>
			console.error('booking sms failed', err)
		);
		return r;
	}
);

/** Public estimate page data for /e/[token]. */
export const getPublicEstimate = query(v.string(), async (token) => {
	const id = verifyEstimateToken(token);
	if (!id) error(404, 'Estimate not found');
	return publicEstimate(id);
});

/** Customer approves or declines an estimate on its public link. */
export const decidePublicEstimate = command(estimateDecisionInput, async (input) => {
	const r = await decideEstimate(input.token, clientIp(), input);
	if (r?.organizationId)
		void notifyStaffEstimateDecision(r.organizationId, r.id).catch((err) =>
			console.error('estimate decision alert failed', err)
		);
	return r;
});

/** Customer asks for changes on the public estimate link — keeps it 'sent' and pings staff. */
export const requestEstimateChangesPublic = command(
	v.object({
		token: v.string(),
		name: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(120))),
		note: v.pipe(v.string(), v.trim(), v.minLength(1, 'Say what to change'), v.maxLength(500))
	}),
	async (input) => {
		const r = await requestEstimateChanges(input.token, clientIp(), input);
		void notifyStaffEstimateChanges(r.organizationId, r.id, input.note).catch((err) =>
			console.error('estimate changes alert failed', err)
		);
		return r;
	}
);

/** Customer names their preferred visit timing after approving an estimate. */
export const setVisitPreferencePublic = command(
	v.object({
		token: v.string(),
		note: v.pipe(v.string(), v.trim(), v.minLength(1, 'Say when works best'), v.maxLength(500))
	}),
	async (input) => setVisitPreference(input.token, input.note)
);

/** Starts provider checkout for an invoice's balance off the public /i/[token] page. */
export const payPublicInvoice = command(
	v.object({ token: v.string(), provider: v.string() }),
	async ({ token, provider }) => ({
		url: await publicInvoiceCheckout(token, provider)
	})
);
