import * as v from 'valibot';
import { command, getRequestEvent, query } from '$app/server';
import { bookingInput, estimateDecisionInput } from '#lib/schemas.ts';
import { getPublicCompany, requestBooking } from '#lib/server/services/public.ts';
import { notifyBookingReceived } from '#lib/server/services/notifications.ts';
import {
	decideEstimate,
	publicEstimate,
	verifyEstimateToken
} from '#lib/server/services/estimates.ts';
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
export const decidePublicEstimate = command(estimateDecisionInput, async (input) =>
	decideEstimate(input.token, clientIp(), input)
);
