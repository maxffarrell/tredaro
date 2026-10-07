import type { PageServerLoad } from './$types';
import { getPublicCompany } from '#lib/server/services/public.ts';

export const load: PageServerLoad = ({ params }) => getPublicCompany(params.slug);
