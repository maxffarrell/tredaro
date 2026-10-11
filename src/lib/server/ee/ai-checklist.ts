/* @license Enterprise */

import { error } from '@sveltejs/kit';
import { aiAvailable, aiChat, aiModel } from './ai.ts';

/**
 * Drafts a job-type checklist — the ordered steps copied onto each new job of
 * that type — from the type's name (plus any extra context the user adds).
 */
export async function draftChecklist(
	name: string,
	context: string
): Promise<{ steps: string[]; model: string }> {
	if (!aiAvailable()) error(403, 'AI requires Tredaro Cloud or an enterprise license');

	const system = [
		'You draft field-service job checklists — the steps a technician ticks off on site.',
		'Reply with ONLY JSON: {"steps":[string]}.',
		'Rules: 4-12 steps, imperative and verifiable ("Verify refrigerant charge"),',
		'ordered by visit flow (arrive → diagnose → work → verify → wrap up);',
		'no numbering, prices, or markdown.'
	].join(' ');

	const user = JSON.stringify({
		jobType: name.slice(0, 200),
		context: context.slice(0, 2000)
	});

	const text = await aiChat(
		[
			{ role: 'system', content: system },
			{ role: 'user', content: user }
		],
		{ maxTokens: 800 }
	);
	return { steps: parseSteps(text), model: aiModel() };
}

export function parseSteps(text: string): string[] {
	const start = text.search(/[[{]/);
	if (start < 0) return [];
	let parsed: unknown = null;
	for (const end of [text.length, ...closingOffsets(text, start).slice(0, 40)]) {
		try {
			const p = JSON.parse(text.slice(start, end));
			if (p && (Array.isArray(p) || typeof p === 'object')) {
				parsed = p;
				break;
			}
		} catch {
			/* shrink and retry */
		}
	}
	const raw = Array.isArray(parsed)
		? parsed
		: parsed && typeof parsed === 'object'
			? ((parsed as Record<string, unknown>).steps ?? [])
			: [];
	if (!Array.isArray(raw)) return [];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const s of raw) {
		if (typeof s !== 'string') continue;
		const step = s.trim().slice(0, 200);
		const key = step.toLowerCase();
		if (!step || seen.has(key)) continue;
		seen.add(key);
		out.push(step);
		if (out.length >= 12) break;
	}
	return out;
}

function closingOffsets(text: string, start: number): number[] {
	const out: number[] = [];
	for (let i = text.length - 1; i > start; i--)
		if (text[i] === '}' || text[i] === ']') out.push(i + 1);
	return out;
}
