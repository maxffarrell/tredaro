import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { jobChecklistItem, jobMaterial } from '#lib/server/db/schema.ts';
import { eq } from 'drizzle-orm';
import { aiAvailable, aiChat, aiModel } from './ai.ts';
import { getJob } from '../services/jobs.ts';

/**
 * Drafts a customer-facing recap of a visit from the tech's notes, checklist and
 * logged materials. Plain language, no prices — staff reviews before posting it
 * as a job note or sending it on the completion email.
 */
export async function suggestServiceSummary(
	orgId: string,
	jobId: string
): Promise<{ summary: string; model: string }> {
	if (!aiAvailable())
		error(
			403,
			'No AI provider configured — set TREDARO_AI_MODEL and an API key or a custom endpoint'
		);

	const [j, materials, checklist] = await Promise.all([
		getJob(orgId, jobId),
		db
			.select({ name: jobMaterial.customName, qty: jobMaterial.qty })
			.from(jobMaterial)
			.where(eq(jobMaterial.jobId, jobId)),
		db
			.select({ label: jobChecklistItem.label, done: jobChecklistItem.done })
			.from(jobChecklistItem)
			.where(eq(jobChecklistItem.jobId, jobId))
	]);

	const notes = j.events
		.filter((e) => e.event.note && e.event.kind !== 'note')
		.slice(-12)
		.map((e) => `${e.event.kind}: ${e.event.note}`);

	const system = [
		'You write visit recaps a field service company sends its customer.',
		'Reply with ONLY the recap text — no greeting, sign-off, bullet list, or quotes.',
		'2-4 sentences, plain language a homeowner understands, past tense.',
		'Say what was found and what was done; mention parts only by plain name, never',
		'skus or prices; never invent work not in the input; skip internal jargon (J-numbers,',
		'event kinds, member names).'
	].join(' ');

	const user = JSON.stringify({
		job: {
			type: j.jobTypeName,
			summary: j.job.summary,
			description: j.job.description,
			equipment: j.equipmentName
		},
		technicianNotes: notes,
		checklist: checklist.map((c) => ({ label: c.label, done: c.done })),
		materials: materials.map((m) => `${m.qty}× ${m.name}`)
	});

	const text = await aiChat([
		{ role: 'system', content: system },
		{ role: 'user', content: user }
	]);
	return {
		summary: text
			.trim()
			.replace(/^["']|["']$/g, '')
			.slice(0, 2000),
		model: aiModel()
	};
}
