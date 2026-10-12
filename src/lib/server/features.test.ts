import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ TREDARO_CLOUD: false, TREDARO_ENTERPRISE_KEY: '' }));
vi.mock('$app/env/private', () => env);

import { hasFeature, isEnterpriseEnabled } from './features.ts';

beforeEach(() => {
	env.TREDARO_CLOUD = false;
	env.TREDARO_ENTERPRISE_KEY = '';
});

describe('self-hosted core features', () => {
	it.each(['sso', 'passkeys', 'ai'] as const)('%s needs no subscription', (feature) => {
		expect(isEnterpriseEnabled()).toBe(false);
		expect(hasFeature(feature)).toBe(true);
	});
});
