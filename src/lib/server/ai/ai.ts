import {
	TREDARO_AI_PROVIDER,
	TREDARO_AI_BASE_URL,
	TREDARO_AI_API_KEY,
	TREDARO_AI_MODEL,
	TREDARO_AI_DECISION_PROVIDER,
	TREDARO_AI_DECISION_BASE_URL,
	TREDARO_AI_DECISION_API_KEY,
	TREDARO_AI_DECISION_MODEL
} from '$app/env/private';
import * as v from 'valibot';
import { extractJson } from './ai-parse.ts';

type AiConfig = { provider: 'openai' | 'anthropic'; base: string; key: string; model: string };

const OPENAI_DEFAULT = 'https://api.openai.com/v1';
const ANTHROPIC_DEFAULT = 'https://api.anthropic.com';

/** Feature endpoint — freeform text generation (`TREDARO_AI_*`). */
function featureConfig(): AiConfig {
	const provider = (
		TREDARO_AI_PROVIDER?.toLowerCase() === 'anthropic' ? 'anthropic' : 'openai'
	) as AiConfig['provider'];
	return {
		provider,
		base: (
			TREDARO_AI_BASE_URL || (provider === 'anthropic' ? ANTHROPIC_DEFAULT : OPENAI_DEFAULT)
		).replace(/\/+$/, ''),
		key: TREDARO_AI_API_KEY || '',
		model: TREDARO_AI_MODEL || (provider === 'anthropic' ? 'claude-sonnet-4-5' : '')
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
	const provider = (
		TREDARO_AI_DECISION_PROVIDER
			? TREDARO_AI_DECISION_PROVIDER.toLowerCase() === 'anthropic'
				? 'anthropic'
				: 'openai'
			: f.provider
	) as AiConfig['provider'];
	const inherited = provider !== f.provider;
	return {
		provider,
		base: (
			TREDARO_AI_DECISION_BASE_URL ||
			(inherited ? (provider === 'anthropic' ? ANTHROPIC_DEFAULT : OPENAI_DEFAULT) : f.base)
		).replace(/\/+$/, ''),
		key: TREDARO_AI_DECISION_API_KEY || (inherited ? '' : f.key),
		model: TREDARO_AI_DECISION_MODEL || (inherited ? '' : f.model)
	};
}

function configured(c: AiConfig): boolean {
	if (!c.model) return false;
	if (c.provider === 'anthropic') return !!(c.key || c.base !== ANTHROPIC_DEFAULT);
	return !!(c.key || c.base !== OPENAI_DEFAULT);
}

/** Whether a text-generation endpoint is configured (key + model). */
export function aiConfigured(): boolean {
	return configured(featureConfig());
}

/** Whether a decision endpoint resolves (decision vars, else feature vars). */
export function aiDecisionConfigured(): boolean {
	return configured(decisionConfig());
}

/** Whether AI features may run: a configured BYOK endpoint. */
export function aiAvailable(): boolean {
	return aiConfigured();
}

/** Whether structured decision calls may run. */
export function aiDecisionAvailable(): boolean {
	return aiDecisionConfigured();
}

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

/** Anthropic Messages API — system is a top-level param, not a message. */
async function anthropicChat(cfg: AiConfig, messages: ChatMessage[], maxTokens: number) {
	const res = await fetch(`${cfg.base}/v1/messages`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-api-key': cfg.key,
			'anthropic-version': '2023-06-01'
		},
		body: JSON.stringify({
			model: cfg.model,
			temperature: 0.2,
			max_tokens: maxTokens,
			system: messages.find((m) => m.role === 'system')?.content,
			messages: messages.filter((m) => m.role !== 'system')
		}),
		signal: AbortSignal.timeout(30_000)
	});
	if (!res.ok) throw new Error(`AI endpoint returned ${res.status}`);
	const data: unknown = await res.json();
	const text = (
		data as { content?: { type: string; text?: unknown }[] } | undefined
	)?.content?.find((b) => b.type === 'text')?.text;
	if (typeof text !== 'string' || !text.trim()) throw new Error('Empty response from AI endpoint');
	return text;
}

async function chat(cfg: AiConfig, messages: ChatMessage[], maxTokens: number) {
	if (cfg.provider === 'anthropic') return anthropicChat(cfg, messages, maxTokens);
	const res = await fetch(`${cfg.base}/chat/completions`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			...(cfg.key ? { authorization: `Bearer ${cfg.key}` } : {})
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
