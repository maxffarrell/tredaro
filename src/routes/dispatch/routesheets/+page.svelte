<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '#lib/components/ui/button/index.js';
	import Printer from '@lucide/svelte/icons/printer';
	import { getDispatchBoard } from '#lib/remote/jobs.remote.ts';
	import { getSettings } from '#lib/remote/workspace.remote.ts';
	import { localDate, localTime, addDays } from '#lib/tz.ts';
	import { SvelteMap } from 'svelte/reactivity';

	const settings = await getSettings();
	const tz = settings.timezone;
	const day = page.url.searchParams.get('day') || localDate(new Date(), tz);
	const board = await getDispatchBoard({ from: day, to: addDays(day, 1) });

	const byTech = new SvelteMap<string, typeof board.scheduled>();
	for (const j of board.scheduled) {
		if (['done', 'cancelled'].includes(j.job.status)) continue;
		const name = j.job.technicianId ? (j.technicianName ?? 'Unassigned') : 'Unassigned';
		if (!byTech.has(name)) byTech.set(name, []);
		byTech.get(name)!.push(j);
	}
	const techs = [...byTech.entries()].sort(([a], [b]) =>
		a === 'Unassigned' ? 1 : b === 'Unassigned' ? -1 : a.localeCompare(b)
	);
	for (const [, rows] of techs)
		rows.sort(
			(a, b) =>
				(a.job.startsAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
				(b.job.startsAt?.getTime() ?? Number.MAX_SAFE_INTEGER)
		);

	const dayLabel = new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', {
		weekday: 'long',
		month: 'long',
		day: 'numeric',
		timeZone: 'UTC'
	});
	const addr = (j: (typeof board.scheduled)[number]) =>
		[j.locationLabel ? `${j.locationLabel}:` : '', j.address1, j.city, j.state]
			.filter(Boolean)
			.join(' ');
	const noteFor = (tech: string) =>
		board.dayNotes.find((n) => n.memberId && nameFor(n.memberId) === tech)?.note;
	const nameFor = (memberId: string) =>
		board.technicians.find((t) => t.id === memberId)?.name ?? '';
	const offNames = board.timeOff.map((t) => nameFor(t.memberId)).filter(Boolean);
</script>

<svelte:head><title>Route sheets — {day}</title></svelte:head>

<div class="min-h-screen bg-white text-neutral-900">
	<div class="mx-auto max-w-3xl p-6 print:max-w-none print:p-0">
		<div class="flex items-start justify-between print:hidden">
			<Button variant="outline" onclick={() => history.back()}>Back</Button>
			<Button onclick={() => window.print()}><Printer /> Print all</Button>
		</div>

		{#each techs as [tech, rows], ti (tech)}
			<section class={ti === 0 ? 'mt-4 print:mt-0' : 'break-before-page'}>
				<header class="border-b-2 border-neutral-800 pb-4">
					<div class="flex items-start justify-between">
						<div>
							{#if settings.logoUrl}
								<img
									src={settings.logoUrl}
									alt={settings.orgName}
									class="mb-2 h-12 object-contain"
								/>
							{/if}
							<p class="text-lg font-bold">{settings.orgName}</p>
							{#if settings.phone}<p class="text-sm">{settings.phone}</p>{/if}
						</div>
						<div class="text-right">
							<h1 class="text-2xl font-bold tracking-tight">Route sheet</h1>
							<p class="text-lg font-semibold">{dayLabel}</p>
							<p class="text-sm">{tech}</p>
						</div>
					</div>
				</header>

				{#if noteFor(tech)}
					<p class="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-sm">
						Dispatch note: {noteFor(tech)}
					</p>
				{/if}
				{#if offNames.includes(tech)}
					<p class="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-sm">
						Marked off this day — verify assignments.
					</p>
				{/if}

				{#each rows as j, i (j.job.id)}
					<div class="mt-4 break-inside-avoid rounded border p-3 text-sm">
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0">
								<p class="font-semibold">
									#{i + 1} · J-{j.job.number} — {j.companyName
										? `${j.companyName} — `
										: ''}{j.customerName}
								</p>
								<p class="text-neutral-600">
									{j.job.startsAt
										? `${localTime(j.job.startsAt, tz)}${j.job.endsAt ? `–${localTime(j.job.endsAt, tz)}` : ''}${j.job.arrivalWindow ? ` (arrival ${j.job.arrivalWindow})` : ''}`
										: 'No start time'}
									{#if j.jobTypeName}· {j.jobTypeName}{/if}· {j.job.status.replace('_', ' ')}
								</p>
							</div>
							{#if j.job.priority !== 'normal'}<p class="font-medium">{j.job.priority}</p>{/if}
						</div>
						{#if addr(j)}<p class="mt-1">{addr(j)}</p>{/if}
						<div class="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-neutral-600">
							{#if j.customerPhone}<p>{j.customerPhone}</p>{/if}
							{#if j.job.preferredTime}<p>Prefers {j.job.preferredTime}</p>{/if}
							{#if j.checklistTotal}<p>Checklist {j.checklistDone}/{j.checklistTotal}</p>{/if}
						</div>
						{#if j.accessNotes}<p class="mt-1 font-medium">Access: {j.accessNotes}</p>{/if}
						{#if j.job.summary}<p class="mt-1">{j.job.summary}</p>{/if}
						{#if j.job.description}
							<p class="mt-0.5 whitespace-pre-wrap text-neutral-600">{j.job.description}</p>
						{/if}
					</div>
				{:else}
					<p class="mt-4 text-sm text-neutral-500">No jobs scheduled for {tech}.</p>
				{/each}

				<p class="mt-4 text-center text-xs text-neutral-400">
					{settings.orgName} · {tech} · {dayLabel}
				</p>
			</section>
		{:else}
			<p class="mt-8 text-center text-sm text-neutral-500">No open jobs scheduled on {dayLabel}.</p>
		{/each}
	</div>
</div>
