/* @license Enterprise */

import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { aiDecision, aiDecisionAvailable, aiDecisionModel } from './ai.ts';
import { dispatchBoard } from '../services/jobs.ts';
import { getSettings } from '../services/settings.ts';
import { zonedToUtc } from '#lib/tz.ts';

export type DispatchSuggestion = { jobId: string; memberId: string; reason: string };

const suggestionRow = v.object({
	jobId: v.string(),
	memberId: v.string(),
	reason: v.pipe(
		v.string(),
		v.transform((s) => s.trim().slice(0, 120))
	)
});

const dispatchResponse = v.union([
	v.object({ suggestions: v.array(v.unknown()) }),
	v.array(v.unknown())
]);

/**
 * Suggests technician assignments for the unscheduled queue on a given day
 * (YYYY-MM-DD, org timezone). The model sees each queued job's type, priority
 * and area plus each tech's skills, day-off status and current load; ids are
 * filtered against the real board so hallucinated assignments can't apply.
 */
export async function suggestDispatch(
	orgId: string,
	day: string
): Promise<{ suggestions: DispatchSuggestion[]; model: string }> {
	if (!aiDecisionAvailable()) error(403, 'AI requires Tredaro Cloud or an enterprise license');

	const tz = (await getSettings(orgId)).timezone;
	const from = zonedToUtc(`${day}T00:00`, tz);
	const board = await dispatchBoard(orgId, from, zonedToUtc(`${day}T23:59`, tz));

	const queue = board.unscheduled.slice(0, 15);
	const techs = board.technicians;
	if (!queue.length) return { suggestions: [], model: aiDecisionModel() };
	if (!techs.length) error(409, 'No dispatchable technicians');

	const system = [
		'You assign field service jobs to technicians.',
		'Reply with ONLY JSON: {"suggestions":[{"jobId":string,"memberId":string,"reason":string}]}.',
		'Rules: only use jobId/memberId values from the input, each job at most once,',
		"reason under 12 words; weigh skill tags vs the job type, keep a tech's stops in the",
		'same area when possible, spread load, skip techs marked off; leave risky picks out.'
	].join(' ');

	const user = JSON.stringify({
		technicians: techs.map((t) => ({
			memberId: t.id,
			name: t.name,
			skills: t.skillTags,
			jobsThatDay: board.scheduled.filter((s) => s.job.technicianId === t.id).length,
			areas: [
				...new Set(
					board.scheduled
						.filter((s) => s.job.technicianId === t.id)
						.map((s) => s.zip || s.city || s.locationLabel || '')
						.filter(Boolean)
				)
			]
		})),
		jobs: queue.map((r) => ({
			jobId: r.job.id,
			number: r.job.number,
			type: r.jobTypeName,
			summary: r.job.summary,
			priority: r.job.priority,
			area: [r.city, r.state, r.zip].filter(Boolean).join(' ') || r.locationLabel || '',
			customer: r.customerName
		}))
	});

	const parsed = await aiDecision(dispatchResponse, system, user, { maxTokens: 1200 });
	const rows = parsed == null ? [] : Array.isArray(parsed) ? parsed : parsed.suggestions;

	const jobIds = new Set(queue.map((r) => r.job.id));
	const memberIds = new Set(techs.map((t) => t.id));
	const seen = new Set<string>();
	const suggestions: DispatchSuggestion[] = [];
	for (const row of rows) {
		const r = v.safeParse(suggestionRow, row);
		if (!r.success) continue;
		const s = r.output;
		if (!s.jobId || !jobIds.has(s.jobId) || !memberIds.has(s.memberId) || seen.has(s.jobId))
			continue;
		seen.add(s.jobId);
		suggestions.push(s);
	}
	return { suggestions, model: aiDecisionModel() };
}
