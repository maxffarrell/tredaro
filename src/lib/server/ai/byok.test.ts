import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({}) as Record<string, string | undefined>);
vi.mock('$app/env/private', () => env);

beforeEach(() => {
	vi.resetModules();
	Object.assign(env, {
		TREDARO_AI_API_KEY: undefined,
		TREDARO_AI_MODEL: 'test-model',
		TREDARO_AI_BASE_URL: undefined,
		TREDARO_AI_DECISION_API_KEY: undefined,
		TREDARO_AI_DECISION_MODEL: undefined,
		TREDARO_AI_DECISION_BASE_URL: undefined
	});
});
afterEach(() => vi.unstubAllGlobals());

describe('BYOK AI without a Cloud flag or enterprise key', () => {
	it('keeps an unconfigured provider unavailable', async () => {
		const ai = await import('./ai.ts');
		expect(ai.aiAvailable()).toBe(false);
		expect(ai.aiDecisionAvailable()).toBe(false);
	});

	it('uses a supplied provider key without any license entitlement', async () => {
		env.TREDARO_AI_API_KEY = 'provider-key';
		const fetchMock = vi
			.fn()
			.mockResolvedValue(Response.json({ choices: [{ message: { content: 'draft' } }] }));
		vi.stubGlobal('fetch', fetchMock);
		const ai = await import('./ai.ts');
		expect(ai.aiAvailable()).toBe(true);
		expect(ai.aiDecisionAvailable()).toBe(true);
		expect(await ai.aiChat([{ role: 'user', content: 'hello' }])).toBe('draft');
		expect(fetchMock.mock.calls[0][1].headers.authorization).toBe('Bearer provider-key');
	});

	it('supports an explicit keyless local endpoint without sending a bearer token', async () => {
		env.TREDARO_AI_BASE_URL = 'http://localhost:11434/v1';
		const fetchMock = vi
			.fn()
			.mockResolvedValue(Response.json({ choices: [{ message: { content: 'local draft' } }] }));
		vi.stubGlobal('fetch', fetchMock);
		const ai = await import('./ai.ts');
		expect(ai.aiAvailable()).toBe(true);
		expect(await ai.aiChat([{ role: 'user', content: 'hello' }])).toBe('local draft');
		expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:11434/v1/chat/completions');
		expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('authorization');
	});

	it('can configure structured calls separately from freeform features', async () => {
		env.TREDARO_AI_DECISION_BASE_URL = 'http://localhost:11434/v1';
		env.TREDARO_AI_DECISION_MODEL = 'decision-model';
		const ai = await import('./ai.ts');
		expect(ai.aiAvailable()).toBe(false);
		expect(ai.aiDecisionAvailable()).toBe(true);
	});
});
