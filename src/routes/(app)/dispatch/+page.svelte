<script lang="ts">
	import { goto } from '$app/navigation';
	import PageHeader from '#lib/components/app/page-header.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { getDispatchBoard } from '#lib/remote/jobs.remote.ts';
	import { getSettings } from '#lib/remote/workspace.remote.ts';
	import { localDate, localTime } from '#lib/tz.ts';
	import { addDays } from '#lib/tz.ts';
	import { SvelteMap } from 'svelte/reactivity';
	import { page } from '$app/state';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Inbox from '@lucide/svelte/icons/inbox';

	const settings = await getSettings();
	const tz = settings.timezone;

	const todayStr = localDate(new Date(), tz);
	let start = $state(page.url.searchParams.get('from') ?? todayStr);
	const board = $derived(await getDispatchBoard({ from: start, to: addDays(start, 7) }));

	function shift(days: number) {
		start = addDays(start, days);
		goto(`?from=${start}`, { replaceState: true });
	}

	const byTech = $derived.by(() => {
		const map = new SvelteMap<string, { name: string; jobs: typeof board.scheduled }>();
		for (const t of board.technicians) map.set(t.id, { name: t.name, jobs: [] });
		map.set('', { name: 'Unassigned', jobs: [] });
		for (const j of board.scheduled) {
			const key = j.job.technicianId ?? '';
			if (!map.has(key)) map.set(key, { name: j.technicianName ?? 'Unassigned', jobs: [] });
			map.get(key)!.jobs.push(j);
		}
		return [...map.entries()].filter(([, v]) => v.jobs.length || v.name !== 'Unassigned');
	});
</script>

<PageHeader title="Dispatch board">
	{#snippet actions()}
		<div class="flex items-center gap-1">
			<Button variant="outline" size="icon" class="size-8" onclick={() => shift(-7)}
				><ChevronLeft /></Button
			>
			<Button variant="ghost" size="sm" onclick={() => (start = todayStr)}>Today</Button>
			<Button variant="outline" size="icon" class="size-8" onclick={() => shift(7)}
				><ChevronRight /></Button
			>
		</div>
	{/snippet}
</PageHeader>

<div class="grid gap-4 p-4 md:p-6 lg:grid-cols-[300px_1fr]">
	<!-- Unscheduled queue -->
	<Card.Root class="h-fit">
		<Card.Header class="flex-row items-center gap-2">
			<Inbox class="size-4 text-muted-foreground" />
			<Card.Title class="text-base">Unscheduled ({board.unscheduled.length})</Card.Title>
		</Card.Header>
		<Card.Content class="space-y-2 px-4">
			{#each board.unscheduled as j (j.job.id)}
				<button
					class="w-full rounded-lg border p-3 text-left transition-colors hover:bg-accent"
					onclick={() => goto(`/jobs/${j.job.id}`)}
				>
					<div class="flex items-center justify-between gap-2">
						<span class="truncate text-sm font-medium">
							{j.job.summary || j.jobTypeName} · {j.customerName}
						</span>
						<StatusBadge status={j.job.priority} />
					</div>
					<p class="mt-1 text-xs text-muted-foreground">
						J-{j.job.number} · {j.job.source}
						{#if j.city}· {j.city}{/if}
					</p>
				</button>
			{:else}
				<p class="py-4 text-sm text-muted-foreground">Queue is clear.</p>
			{/each}
		</Card.Content>
	</Card.Root>

	<!-- Scheduled, grouped by technician -->
	<div class="space-y-4">
		{#each byTech as [techId, group] (techId || 'unassigned')}
			<Card.Root>
				<Card.Header>
					<Card.Title class="text-base">{group.name}</Card.Title>
				</Card.Header>
				<Card.Content class="px-4">
					{#if group.jobs.length === 0}
						<p class="py-2 text-sm text-muted-foreground">No jobs this week.</p>
					{:else}
						<ul class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
							{#each group.jobs as j (j.job.id)}
								<li>
									<button
										class="w-full rounded-lg border p-3 text-left transition-colors hover:bg-accent"
										onclick={() => goto(`/jobs/${j.job.id}`)}
									>
										<div class="flex items-center gap-2">
											<span
												class="inline-block size-2 shrink-0 rounded-full"
												style:background={j.color}
											></span>
											<span class="truncate text-sm font-medium"
												>{j.job.summary || j.jobTypeName}</span
											>
											<StatusBadge status={j.job.status} class="ml-auto" />
										</div>
										<p class="mt-1 text-xs text-muted-foreground">
											J-{j.job.number} · {j.customerName} ·
											{j.job.startsAt
												? `${localDate(j.job.startsAt, tz)} ${localTime(j.job.startsAt, tz)}`
												: 'unscheduled'}
										</p>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</Card.Content>
			</Card.Root>
		{/each}
	</div>
</div>
