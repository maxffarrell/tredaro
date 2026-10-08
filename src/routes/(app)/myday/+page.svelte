<script lang="ts">
	import PageHeader from '#lib/components/app/page-header.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { toast } from 'svelte-sonner';
	import {
		getMyDay,
		recordJobEvent,
		signJob,
		startTimer,
		stopTimer,
		getCalendarFeed
	} from '#lib/remote/jobs.remote.ts';
	import SignatureDialog from '#lib/components/app/signature-dialog.svelte';
	import { errMsg } from '#lib/format.ts';
	import { localTime } from '#lib/tz.ts';
	import Truck from '@lucide/svelte/icons/truck';
	import Navigation from '@lucide/svelte/icons/navigation';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Play from '@lucide/svelte/icons/play';
	import Square from '@lucide/svelte/icons/square';
	import Timer from '@lucide/svelte/icons/timer';
	import CalendarCheck from '@lucide/svelte/icons/calendar-check';
	import CalendarPlus from '@lucide/svelte/icons/calendar-plus';

	const day = $derived(await getMyDay());
	const tz = $derived(day.tz);
	const calFeed = $derived(await getCalendarFeed());
	function copyCal() {
		if (!calFeed) return;
		navigator.clipboard
			.writeText(`${location.origin}${calFeed}`)
			.then(() => toast.success('Calendar feed URL copied — subscribe in your calendar app'))
			.catch(() => toast.info(`${location.origin}${calFeed}`));
	}

	type EventKind = 'dispatched' | 'en_route' | 'on_site' | 'completed';
	const NEXT: Record<string, { kind: EventKind; label: string }[]> = {
		scheduled: [{ kind: 'dispatched', label: 'Dispatch' }],
		dispatched: [
			{ kind: 'en_route', label: 'En route' },
			{ kind: 'on_site', label: 'On site' }
		],
		in_progress: [{ kind: 'completed', label: 'Complete' }]
	};
	const ICONS = {
		dispatched: Truck,
		en_route: Navigation,
		on_site: MapPin,
		completed: CircleCheck
	};

	let pending = $state<string | null>(null);
	let signJobId = $state<string | null>(null);

	async function completeWithSignature(name: string, dataUrl: string) {
		const jobId = signJobId;
		if (!jobId) return;
		pending = `${jobId}:completed`;
		try {
			await signJob({ jobId, name, signature: dataUrl });
			signJobId = null;
			await recordJobEvent({ jobId, kind: 'completed' }).updates(getMyDay);
			toast.success('Job done');
		} catch (err) {
			toast.error(errMsg(err, 'Could not update'));
		}
		pending = null;
	}

	async function advance(jobId: string, kind: EventKind) {
		pending = `${jobId}:${kind}`;
		try {
			await recordJobEvent({ jobId, kind }).updates(getMyDay);
			toast.success(kind === 'completed' ? 'Job done' : `Marked ${kind.replace('_', ' ')}`);
		} catch (err) {
			toast.error(errMsg(err, 'Could not update'));
		}
		pending = null;
	}

	async function clock(jobId: string) {
		pending = `${jobId}:clock`;
		try {
			if (day.openEntry?.entry.jobId === jobId) {
				await stopTimer(jobId).updates(getMyDay);
				toast.success('Clocked out');
			} else {
				await startTimer(jobId).updates(getMyDay);
				toast.success('Clocked in');
			}
		} catch (err) {
			toast.error(errMsg(err, 'Could not update timer'));
		}
		pending = null;
	}
</script>

{#snippet jobCard(j: (typeof day.jobs)[number])}
	<Card.Root>
		<Card.Content class="flex flex-col gap-3 p-4">
			<div class="flex items-start justify-between gap-2">
				<div class="min-w-0">
					<a
						href="/jobs/{j.job.id}"
						class="font-medium hover:underline"
						data-sveltekit-preload-data="tap"
					>
						J-{j.job.number}
						{j.job.summary || j.jobTypeName || 'Service call'}
					</a>
					<p class="truncate text-sm text-muted-foreground">
						{j.companyName ?? j.customerName}{#if j.locationLabel}
							· {j.locationLabel}{/if}
					</p>
					{#if j.address1}
						<p class="truncate text-xs text-muted-foreground">
							{j.address1}{j.city ? `, ${j.city}` : ''}{j.state ? ` ${j.state}` : ''}
						</p>
					{/if}
					{#if j.accessNotes}
						<p class="truncate text-xs font-medium text-amber-600 dark:text-amber-500">
							{j.accessNotes}
						</p>
					{/if}
				</div>
				<StatusBadge status={j.job.status} />
			</div>
			<div class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
				{#if j.job.startsAt}
					<span>
						{localTime(j.job.startsAt, tz)}{#if j.job.endsAt}–{localTime(j.job.endsAt, tz)}{/if}
					</span>
				{:else}
					<span>Not scheduled</span>
				{/if}
				{#if j.job.priority === 'high' || j.job.priority === 'urgent'}
					<Badge variant="destructive">{j.job.priority}</Badge>
				{/if}
				{#if day.openEntry?.entry.jobId === j.job.id}
					<Badge variant="secondary">
						<Timer class="mr-1 size-3" /> since {localTime(day.openEntry.entry.startedAt, tz)}
					</Badge>
				{/if}
			</div>
			<div class="flex flex-wrap gap-2">
				{#each NEXT[j.job.status] ?? [] as action (action.kind)}
					{@const Icon = ICONS[action.kind]}
					<Button
						size="sm"
						variant={action.kind === 'completed' ? 'default' : 'outline'}
						disabled={pending !== null}
						onclick={() =>
							action.kind === 'completed' ? (signJobId = j.job.id) : advance(j.job.id, action.kind)}
						><Icon /> {action.label}</Button
					>
				{/each}
				{#if j.job.status !== 'done' && j.job.status !== 'cancelled'}
					<Button
						size="sm"
						variant="ghost"
						disabled={pending !== null}
						onclick={() => clock(j.job.id)}
					>
						{#if day.openEntry?.entry.jobId === j.job.id}
							<Square /> Clock out
						{:else}
							<Play /> Clock in
						{/if}
					</Button>
				{/if}
			</div>
		</Card.Content>
	</Card.Root>
{/snippet}

{#snippet calActions()}
	{#if calFeed}
		<Button variant="outline" size="sm" onclick={copyCal} title="Subscribe to your schedule">
			<CalendarPlus /> Calendar
		</Button>
	{/if}
{/snippet}

<PageHeader title="My Day" actions={calActions} />

<div class="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 md:p-6">
	<p class="text-sm text-muted-foreground">
		{new Date(`${day.today}T12:00:00Z`).toLocaleDateString('en-US', {
			weekday: 'long',
			month: 'long',
			day: 'numeric',
			timeZone: 'UTC'
		})}
	</p>

	{#if !day.member}
		<Card.Root>
			<Card.Content class="p-4 text-sm text-muted-foreground">
				Your account isn't a staff member of this workspace, so no jobs can be assigned to you.
			</Card.Content>
		</Card.Root>
	{:else}
		{#if day.openEntry && !day.jobs.some((j) => j.job.id === day.openEntry?.entry.jobId)}
			<Card.Root class="border-primary/40">
				<Card.Content class="flex items-center justify-between gap-2 p-4 text-sm">
					<span>
						<Timer class="mr-1 inline size-4" /> Clocked in on J-{day.openEntry.jobNumber} since
						{localTime(day.openEntry.entry.startedAt, tz)}
					</span>
					<Button
						size="sm"
						variant="outline"
						disabled={pending !== null}
						onclick={() => clock(day.openEntry!.entry.jobId)}><Square /> Clock out</Button
					>
				</Card.Content>
			</Card.Root>
		{/if}

		{#each day.jobs as j (j.job.id)}
			{@render jobCard(j)}
		{:else}
			<Card.Root>
				<Card.Content class="p-0">
					<Empty.Root class="border-0">
						<Empty.Header>
							<Empty.Media><CalendarCheck /></Empty.Media>
							<Empty.Title>Nothing scheduled</Empty.Title>
							<Empty.Description>
								No jobs on your schedule for today. Check the unscheduled queue below or enjoy the
								break.
							</Empty.Description>
						</Empty.Header>
					</Empty.Root>
				</Card.Content>
			</Card.Root>
		{/each}

		{#if day.unscheduled.length}
			<h2 class="mt-2 text-sm font-medium text-muted-foreground">
				Unassigned time ({day.unscheduled.length})
			</h2>
			{#each day.unscheduled as j (j.job.id)}
				{@render jobCard(j)}
			{/each}
		{/if}
	{/if}
</div>

<SignatureDialog
	bind:open={() => signJobId !== null, (v) => (signJobId = v ? signJobId : null)}
	pending={pending !== null}
	onSave={completeWithSignature}
	skipLabel="Complete without signature"
	onSkip={() => {
		const jobId = signJobId;
		signJobId = null;
		if (jobId) advance(jobId, 'completed');
	}}
/>
