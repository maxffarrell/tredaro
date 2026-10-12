import { TREDARO_CLOUD, TREDARO_ENTERPRISE_KEY } from '$app/env/private';

export type Feature = 'sso' | 'passkeys' | 'ai';

/**
 * Enterprise features are enabled on Tredaro Cloud, or on self-hosted installs
 * with a license key. Subscription validation is not yet implemented.
 * Basic SSO, passkeys and BYOK AI are core features on every install.
 */
export function isEnterpriseEnabled(): boolean {
	return TREDARO_CLOUD === true || !!TREDARO_ENTERPRISE_KEY;
}

export function hasFeature(feature: Feature): boolean {
	if (feature === 'sso' || feature === 'passkeys' || feature === 'ai') return true;
	return isEnterpriseEnabled();
}
