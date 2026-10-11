/* @license Enterprise */

import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { aiDecision, aiDecisionAvailable, aiDecisionModel } from './ai.ts';

const stepsResponse = v.union([v.object({ steps: v.array(v.unknown()) }), v.array(v.unknown())]);

/**
 * Drafts a job-type checklist — the ordered steps copied onto each new job of
 * that type — from the type's name (plus any extra context the user adds).
 */
export async function draftChecklist(
	name: string,
	context: string
): Promise<{ steps: string[]; model: string }> {
	if (!aiDecisionAvailable()) error(403, 'AI requires Tredaro Cloud or an enterprise license');

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

	const parsed = await aiDecision(stepsResponse, system, user, { maxTokens: 800 });
	const rows = parsed == null ? [] : Array.isArray(parsed) ? parsed : parsed.steps;

	const out: string[] = [];
	const seen = new Set<string>();
	for (const s of rows) {
		if (typeof s !== 'string') continue;
		const step = s.trim().slice(0, 200);
		const key = step.toLowerCase();
		if (!step || seen.has(key)) continue;
		seen.add(key);
		out.push(step);
		if (out.length >= 12) break;
	}
	return { steps: out, model: aiDecisionModel() };
}
