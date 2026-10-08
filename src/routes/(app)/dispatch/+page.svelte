<script lang="ts">
	import { goto } from '$app/navigation';
	import PageHeader from '#lib/components/app/page-header.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { getDispatchBoard, updateJob } from '#lib/remote/jobs.remote.ts';
	import { getOffices, getSettings } from '#lib/remote/workspace.remote.ts';
	import * as Select from '#lib/components/ui/select/index.js';
	import { localDate, localTime } from '#lib/tz.ts';
	import { addDays } from '#lib/tz.ts';
	import { SvelteMap } from 'svelte/reactivity';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { errMsg } from '#lib/format.ts';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Inbox from '@lucide/svelte/icons/inbox';

	const settings = await getSettings();
	const offices = await getOffices();
	let officeId = $state(page.url.searchParams.get('office') ?? '');
	const officeName = $derived(offices.find((o) => o.id === officeId)?.name ?? '');
	const tz = settings.timezone;

	const todayStr = localDate(new Date(), tz);
	let start = $state(page.url.searchParams.get('from') ?? todayStr);
	const board = $derived(
		await getDispatchBoard({ from: start, to: addDays(start, 7), officeId: officeId || undefined })
	);

	function shift(days: number) {
		start = addDays(start, days);
		goto(`?from=${start}`, { replaceState: true });
	}

	// ------- drag to reassign / unschedule -------
	let dropZone = $state<string | null>(null);
	function dragJob(e: DragEvent, j: { job: { id: string } }) {
		e.dataTransfer?.setData('text/plain', j.job.id);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
	}
	function allowDrop(e: DragEvent) {
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
	}
	async function dropOn(e: DragEvent, techId: string | 'queue') {
		e.preventDefault();
		dropZone = null;
		const jobId = e.dataTransfer?.getData('text/plain');
		if (!jobId) return;
		try {
			if (techId === 'queue') {
				await updateJob({ id: jobId, startsAt: null }).updates(getDispatchBoard);
				toast.success('Job unscheduled');
			} else {
				// Unscheduled jobs dropped on a tech get an 8am slot on the board's first day.
				const job = board.unscheduled.find((j) => j.job.id === jobId);
				await updateJob({
					id: jobId,
					technicianId: techId || null,
					...(job ? { startsAt: `${start}T08:00` } : {})
				}).updates(getDispatchBoard);
				toast.success('Job reassigned');
			}
		} catch (err) {
			toast.error(errMsg(err, 'Could not move job'));
		}
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
			{#if offices.length > 1}
				<Select.Root
					type="single"
					value={officeId}
					onValueChange={(v) => {
						officeId = v === 'all' ? '' : v;
						goto(`?from=${start}${officeId ? `&office=${officeId}` : ''}`, {
							replaceState: true
						});
					}}
				>
					<Select.Trigger class="h-8 w-40">{officeName || 'All offices'}</Select.Trigger>
					<Select.Content>
						<Select.Item value="all">All offices</Select.Item>
						{#each offices as o (o.id)}
							<Select.Item value={o.id}>{o.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			{/if}
			<Button variant="outline" size="icon" class="size-8" onclick={() => shift(-7)}
				><ChevronLeft /></Button
			>
			<Button
				variant="ghost"
				size="sm"
				onclick={() => goto(`?from=${todayStr}`, { replaceState: true })}>Today</Button
			>
			<Button variant="outline" size="icon" class="size-8" onclick={() => shift(7)}
				><ChevronRight /></Button
			>
		</div>
	{/snippet}
</PageHeader>

<div class="grid gap-4 p-4 md:p-6 lg:grid-cols-[300px_1fr]">
	<!-- Unscheduled queue -->
	<Card.Root
		class="h-fit {dropZone === 'queue' ? 'ring-2 ring-primary' : ''}"
		ondragover={allowDrop}
		ondragenter={() => (dropZone = 'queue')}
		ondragleave={() => (dropZone = null)}
		ondrop={(e) => dropOn(e, 'queue')}
	>
		<Card.Header class="flex-row items-center gap-2">
			<Inbox class="size-4 text-muted-foreground" />
			<Card.Title class="text-base">Unscheduled ({board.unscheduled.length})</Card.Title>
		</Card.Header>
		<Card.Content class="space-y-2 px-4">
			{#each board.unscheduled as j (j.job.id)}
				<button
					class="w-full cursor-grab rounded-lg border p-3 text-left transition-colors hover:bg-accent"
					draggable="true"
					ondragstart={(e) => dragJob(e, j)}
					ondragover={allowDrop}
					ondrop={(e) => {
						e.stopPropagation();
						dropOn(e, 'queue');
					}}
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
						{#if j.job.blocked}· <span class="text-amber-600 dark:text-amber-400">parts</span>{/if}
						{#if j.city}· {j.city}{/if}
						{#if j.job.preferredTime}
							<br /><span class="text-amber-600 dark:text-amber-400"
								>Asked: {j.job.preferredTime}</span
							>
						{/if}
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
			<Card.Root
				class={dropZone === (techId || 'unassigned') ? 'ring-2 ring-primary' : ''}
				ondragover={allowDrop}
				ondragenter={() => (dropZone = techId || 'unassigned')}
				ondragleave={() => (dropZone = null)}
				ondrop={(e) => dropOn(e, techId)}
			>
				<Card.Header>
					<Card.Title class="flex items-center gap-2 text-base">
						{group.name}
						{#each board.timeOff.filter((t) => t.memberId === techId) as t (t.id)}
							<Badge variant="secondary" class="font-normal text-amber-700 dark:text-amber-400">
								Off {t.startsOn}{t.endsOn !== t.startsOn ? ` – ${t.endsOn}` : ''}
							</Badge>
						{/each}
					</Card.Title>
				</Card.Header>
				<Card.Content class="px-4">
					{#if group.jobs.length === 0}
						<p class="py-2 text-sm text-muted-foreground">No jobs this week.</p>
					{:else}
						<ul class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
							{#each group.jobs as j (j.job.id)}
								<li>
									<button
										class="w-full cursor-grab rounded-lg border p-3 text-left transition-colors hover:bg-accent"
										draggable="true"
										ondragstart={(e) => dragJob(e, j)}
										ondragover={allowDrop}
										ondrop={(e) => {
											e.stopPropagation();
											dropOn(e, techId);
										}}
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
											{#if j.job.blocked}
												· <span class="text-amber-600 dark:text-amber-400">parts</span>
											{/if}
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
