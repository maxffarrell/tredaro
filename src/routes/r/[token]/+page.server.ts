import type { PageServerLoad } from './$types';
import { publicServiceReport, verifyServiceReportToken } from '#lib/server/services/jobs.ts';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = ({ params }) => {
	const id = verifyServiceReportToken(params.token);
	if (!id) error(404, 'Report not found');
	return publicServiceReport(id);
};
