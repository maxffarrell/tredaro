import type { PageServerLoad } from './$types';
import { isDemo } from '#lib/server/demo-mode.ts';

export const load: PageServerLoad = () => ({ security: !isDemo() });
