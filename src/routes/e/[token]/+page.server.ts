import type { PageServerLoad } from './$types';
import { verifyEstimateToken, publicEstimate } from '#lib/server/services/estimates.ts';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = ({ params }) => {
	const id = verifyEstimateToken(params.token);
	if (!id) error(404, 'Estimate not found');
	return publicEstimate(id);
};
