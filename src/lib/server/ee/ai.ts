/* @license Enterprise */

import { TREDARO_AI_BASE_URL, TREDARO_AI_API_KEY, TREDARO_AI_MODEL } from '$app/env/private';
import { hasFeature } from './license.ts';

/** Whether an OpenAI-compatible endpoint is configured (key + model). */
export function aiConfigured(): boolean {
	return !!(TREDARO_AI_API_KEY && TREDARO_AI_MODEL);
}

/** Whether AI features may run: enterprise license + a configured BYOK endpoint. */
export function aiAvailable(): boolean {
	return hasFeature('ai') && aiConfigured();
}

type ChatMessage = { role: 'system' | 'user'; content: string };

/**
 * One chat completion against the install's OpenAI-compatible endpoint
 * (`TREDARO_AI_BASE_URL` + `TREDARO_AI_API_KEY` + `TREDARO_AI_MODEL`). Works with
 * OpenAI, OpenRouter, Azure, Ollama, vLLM, LiteLLM — anything speaking
 * `/chat/completions`. Returns the assistant text.
 */
export async function aiChat(messages: ChatMessage[], opts: { maxTokens?: number } = {}) {
	const base = (TREDARO_AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
	const res = await fetch(`${base}/chat/completions`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${TREDARO_AI_API_KEY}`
		},
		body: JSON.stringify({
			model: TREDARO_AI_MODEL,
			temperature: 0.2,
			max_tokens: opts.maxTokens ?? 1024,
			messages
		}),
		signal: AbortSignal.timeout(30_000)
	});
	if (!res.ok) throw new Error(`AI endpoint returned ${res.status}`);
	const data: unknown = await res.json();
	const text = (data as { choices?: { message?: { content?: unknown } }[] } | undefined)
		?.choices?.[0]?.message?.content;
	if (typeof text !== 'string' || !text.trim()) throw new Error('Empty response from AI endpoint');
	return text;
}

export function aiModel(): string {
	return TREDARO_AI_MODEL || '';
}
