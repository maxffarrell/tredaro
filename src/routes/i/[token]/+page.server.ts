import type { PageServerLoad } from './$types';
import { publicInvoice, verifyInvoiceToken } from '#lib/server/services/billing.ts';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = ({ params }) => {
	const id = verifyInvoiceToken(params.token);
	if (!id) error(404, 'Invoice not found');
	return publicInvoice(id);
};
