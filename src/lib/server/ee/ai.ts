/* @license Enterprise */

import {
	TREDARO_AI_BASE_URL,
	TREDARO_AI_API_KEY,
	TREDARO_AI_MODEL,
	TREDARO_AI_DECISION_BASE_URL,
	TREDARO_AI_DECISION_API_KEY,
	TREDARO_AI_DECISION_MODEL
} from '$app/env/private';
import * as v from 'valibot';
import { hasFeature } from './license.ts';
import { extractJson } from './ai-parse.ts';

type AiConfig = { base: string; key: string; model: string };

/** Feature endpoint — freeform text generation (`TREDARO_AI_*`). */
function featureConfig(): AiConfig {
	return {
		base: (TREDARO_AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
		key: TREDARO_AI_API_KEY || '',
		model: TREDARO_AI_MODEL || ''
	};
}

/**
 * Decision endpoint — structured-JSON calls (`TREDARO_AI_DECISION_*`). Each var
 * falls back to the matching `TREDARO_AI_*` value so a single-key install
 * works unchanged and installs can route extraction at a different model or
 * gateway without touching prose features.
 */
function decisionConfig(): AiConfig {
	const f = featureConfig();
	return {
		base: (TREDARO_AI_DECISION_BASE_URL || f.base).replace(/\/+$/, ''),
		key: TREDARO_AI_DECISION_API_KEY || f.key,
		model: TREDARO_AI_DECISION_MODEL || f.model
	};
}

/** Whether a text-generation endpoint is configured (key + model). */
export function aiConfigured(): boolean {
	const c = featureConfig();
	return !!(c.key && c.model);
}

/** Whether a decision endpoint resolves (decision vars, else feature vars). */
export function aiDecisionConfigured(): boolean {
	const c = decisionConfig();
	return !!(c.key && c.model);
}

/** Whether AI features may run: enterprise license + a configured BYOK endpoint. */
export function aiAvailable(): boolean {
	return hasFeature('ai') && aiConfigured();
}

/** Whether structured decision calls may run. */
export function aiDecisionAvailable(): boolean {
	return hasFeature('ai') && aiDecisionConfigured();
}

type ChatMessage = { role: 'system' | 'user'; content: string };

async function chat(cfg: AiConfig, messages: ChatMessage[], maxTokens: number) {
	const res = await fetch(`${cfg.base}/chat/completions`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${cfg.key}`
		},
		body: JSON.stringify({
			model: cfg.model,
			temperature: 0.2,
			max_tokens: maxTokens,
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

/**
 * One chat completion against the install's OpenAI-compatible endpoint
 * (`TREDARO_AI_BASE_URL` + `TREDARO_AI_API_KEY` + `TREDARO_AI_MODEL`). Works with
 * OpenAI, OpenRouter, Azure, Ollama, vLLM, LiteLLM — anything speaking
 * `/chat/completions`. Returns the assistant text.
 */
export async function aiChat(messages: ChatMessage[], opts: { maxTokens?: number } = {}) {
	return chat(featureConfig(), messages, opts.maxTokens ?? 1024);
}

/**
 * A structured decision call against the decision endpoint. The model's reply
 * is extracted (tolerating prose/code fences) and validated with `v.safeParse`
 * — callers get a typed `v.InferOutput<S>` or `null` and apply their usual
 * fallback (empty list/draft). Per-row leniency lives in the caller's schema
 * (e.g. `v.array(v.unknown())` rows validated one by one).
 */
export async function aiDecision<S extends v.GenericSchema>(
	schema: S,
	system: string,
	input: unknown,
	opts: { maxTokens?: number } = {}
): Promise<v.InferOutput<S> | null> {
	const text = await chat(
		decisionConfig(),
		[
			{ role: 'system', content: system },
			{ role: 'user', content: typeof input === 'string' ? input : JSON.stringify(input) }
		],
		opts.maxTokens ?? 1024
	);
	const parsed = extractJson(text);
	if (parsed == null) return null;
	const result = v.safeParse(schema, parsed);
	return result.success ? result.output : null;
}

export function aiModel(): string {
	return TREDARO_AI_MODEL || '';
}

/** The model decision calls resolve to (decision var, else feature var). */
export function aiDecisionModel(): string {
	return decisionConfig().model;
}
