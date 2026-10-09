<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '#lib/components/ui/button/index.js';
	import Printer from '@lucide/svelte/icons/printer';
	import { getDispatchBoard } from '#lib/remote/jobs.remote.ts';
	import { getSettings } from '#lib/remote/workspace.remote.ts';
	import { localDate, localTime, addDays } from '#lib/tz.ts';

	const settings = await getSettings();
	const tz = settings.timezone;
	const from = $derived(page.url.searchParams.get('from') ?? localDate(new Date(), tz));
	const board = $derived(await getDispatchBoard({ from, to: addDays(from, 7) }));

	const days = $derived(Array.from({ length: 7 }, (_, i) => addDays(from, i)));
	const dayLabel = (d: string) =>
		new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', {
			weekday: 'short',
			month: 'numeric',
			day: 'numeric',
			timeZone: 'UTC'
		});
	const jobsOn = (techId: string | null, day: string) =>
		board.scheduled.filter(
			(j) =>
				(j.job.technicianId ?? null) === techId &&
				j.job.startsAt &&
				localDate(new Date(j.job.startsAt), tz) === day
		);
	const hasUnassigned = $derived(board.scheduled.some((j) => !j.job.technicianId));
	const offOn = (memberId: string, day: string) =>
		board.timeOff.some((o) => o.memberId === memberId && o.startsOn <= day && o.endsOn >= day);
</script>

<svelte:head><title>Schedule — week of {dayLabel(from)}</title></svelte:head>

<div class="min-h-screen bg-white text-neutral-900">
	<div class="p-4 print:p-0">
		<div class="flex items-start justify-between print:hidden">
			<Button variant="outline" onclick={() => history.back()}>Back</Button>
			<Button onclick={() => window.print()}><Printer /> Print</Button>
		</div>

		<header class="mt-3 border-b-2 border-neutral-800 pb-2 print:mt-0">
			<p class="text-lg font-bold">{settings.orgName}</p>
			<p class="text-sm">Week of {dayLabel(from)} — {dayLabel(addDays(from, 6))}</p>
		</header>

		<table class="mt-3 w-full border-collapse text-xs">
			<thead>
				<tr>
					<th class="border border-neutral-300 bg-neutral-100 p-1.5 text-left">Technician</th>
					{#each days as d (d)}
						<th class="border border-neutral-300 bg-neutral-100 p-1.5 text-left">{dayLabel(d)}</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each board.technicians as tech (tech.id)}
					<tr>
						<td class="border border-neutral-300 p-1.5 align-top font-medium">{tech.name}</td>
						{#each days as d (d)}
							<td class="border border-neutral-300 p-1.5 align-top">
								{#if offOn(tech.id, d)}
									<span class="text-neutral-500 italic">Off</span>
								{/if}
								{#each jobsOn(tech.id, d) as j (j.job.id)}
									<p class="mb-1">
										<span class="font-medium"
											>{localTime(new Date(j.job.startsAt!), tz)} J-{j.job.number}</span
										><br />{j.job.summary || j.jobTypeName} — {j.customerName}
									</p>
								{/each}
							</td>
						{/each}
					</tr>
				{/each}
				{#if hasUnassigned}
					<tr>
						<td class="border border-neutral-300 p-1.5 align-top font-medium text-neutral-500"
							>Unassigned</td
						>
						{#each days as d (d)}
							<td class="border border-neutral-300 p-1.5 align-top">
								{#each jobsOn(null, d) as j (j.job.id)}
									<p class="mb-1">
										<span class="font-medium"
											>{localTime(new Date(j.job.startsAt!), tz)} J-{j.job.number}</span
										><br />{j.job.summary || j.jobTypeName} — {j.customerName}
									</p>
								{/each}
							</td>
						{/each}
					</tr>
				{/if}
			</tbody>
		</table>

		{#if board.unscheduled.length}
			<p class="mt-3 text-xs text-neutral-500">
				Unscheduled queue: {board.unscheduled.length} job{board.unscheduled.length === 1 ? '' : 's'} waiting
			</p>
		{/if}
	</div>
</div>

<style>
	@media print {
		@page {
			orientation: landscape;
		}
	}
</style>
