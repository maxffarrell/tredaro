<script lang="ts">
	import PageHeader from '#lib/components/app/page-header.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
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
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
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
	import StickyNote from '@lucide/svelte/icons/sticky-note';
	import Phone from '@lucide/svelte/icons/phone';
	import ListChecks from '@lucide/svelte/icons/list-checks';

	const day = $derived(await getMyDay());
	const tomorrowSchedMin = $derived(
		(day.tomorrow ?? []).reduce(
			(m, j) =>
				m +
				(j.job.startsAt && j.job.endsAt
					? (new Date(j.job.endsAt).getTime() - new Date(j.job.startsAt).getTime()) / 60_000
					: 0),
			0
		)
	);
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
	let noteJobId = $state<string | null>(null);
	let noteText = $state('');

	async function saveNote() {
		if (!noteJobId || !noteText.trim()) return;
		pending = `${noteJobId}:note`;
		try {
			await recordJobEvent({ jobId: noteJobId, kind: 'note', note: noteText.trim() }).updates(
				getMyDay
			);
			noteJobId = null;
			noteText = '';
			toast.success('Note added to the job timeline');
		} catch (err) {
			toast.error(errMsg(err, 'Could not add note'));
		}
		pending = null;
	}

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
					{#if j.address1}
						<a
							class="mt-0.5 inline-flex items-center gap-1 text-xs text-primary hover:underline"
							href="https://www.google.com/maps/search/{encodeURIComponent(
								`${j.address1}, ${j.city ?? ''} ${j.state ?? ''} ${j.zip ?? ''}`
							)}"
							target="_blank"
							rel="noreferrer"><MapPin class="size-3" /> Directions</a
						>
					{/if}
					{#if j.job.preferredTime}
						<p class="truncate text-xs text-muted-foreground">Prefers {j.job.preferredTime}</p>
					{/if}
					{#if j.customerPhone}
						<a
							class="inline-flex items-center gap-1 text-primary hover:underline"
							href="tel:{j.customerPhone}"
							title="Call {j.customerName}"><Phone class="size-3" /> Call</a
						>
					{/if}
					{#if j.accessNotes}
						<p class="truncate text-xs font-medium text-amber-600 dark:text-amber-500">
							{j.accessNotes}
						</p>
					{/if}
				</div>
				<StatusBadge status={j.job.status} />
				{#if j.job.blocked}
					<Badge variant="outline" class="text-amber-600 dark:text-amber-400">parts</Badge>
				{/if}
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
				{#if j.checklistTotal > 0}
					<Badge variant={j.checklistDone >= j.checklistTotal ? 'secondary' : 'outline'}>
						<ListChecks class="mr-1 size-3" />
						{j.checklistDone}/{j.checklistTotal}
					</Badge>
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
						onclick={() => (noteJobId = j.job.id)}><StickyNote /> Note</Button
					>
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

	{#if day.offToday}
		<div
			class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900/40 dark:bg-amber-950/30"
		>
			<span class="font-medium"
				>You're off today{day.offToday.reason ? `: ${day.offToday.reason}` : ''}.</span
			>
			Anything below was already on your schedule — coordinate with the office if it needs reassigning.
		</div>
	{/if}

	{#if day.member && (day.jobs.length || day.minutesLogged > 0)}
		{@const done = day.jobs.filter((j) => j.job.status === 'done').length}
		{@const left = day.jobs.length - done}
		{@const next = day.jobs.find((j) => j.job.status !== 'done' && j.job.startsAt)}
		{@const lastEnd = day.jobs
			.filter((j) => j.job.endsAt && j.job.status !== 'cancelled')
			.map((j) => j.job.endsAt?.getTime() ?? 0)
			.sort((a, b) => a - b)
			.at(-1)}
		{@const schedMin = day.jobs.reduce(
			(m, j) =>
				m +
				(j.job.startsAt && j.job.endsAt && j.job.status !== 'cancelled'
					? (new Date(j.job.endsAt).getTime() - new Date(j.job.startsAt).getTime()) / 60_000
					: 0),
			0
		)}
		<div class="flex flex-wrap gap-4 rounded-lg border bg-card px-4 py-2.5 text-sm">
			<span class="tabular-nums"><span class="font-semibold">{done}</span> done</span>
			<span class="tabular-nums"><span class="font-semibold">{left}</span> left</span>
			{#if day.jobs.filter((j) => j.job.equipmentId).length}
				<span class="text-muted-foreground tabular-nums"
					>{day.jobs.filter((j) => j.job.equipmentId).length} on equipment</span
				>
			{/if}
			{#if day.jobs.filter((j) => j.job.priority === 'urgent' || j.job.priority === 'high').length}
				<span class="font-medium text-red-600 tabular-nums dark:text-red-400"
					>{day.jobs.filter((j) => j.job.priority === 'urgent' || j.job.priority === 'high').length} urgent/high</span
				>
			{/if}
			{#if day.jobs.filter((j) => j.confirmed).length}
				<span class="text-muted-foreground tabular-nums"
					>{day.jobs.filter((j) => j.confirmed).length} confirmed</span
				>
			{/if}
			{#if next?.job.startsAt}
				<span class="text-muted-foreground tabular-nums"
					>next {localTime(next.job.startsAt, tz)}</span
				>
			{/if}
			{#if schedMin > 0}
				<span class="text-muted-foreground tabular-nums"
					>{Math.floor(schedMin / 60)}h {Math.round(schedMin % 60)}m scheduled</span
				>
			{/if}
			{#if lastEnd}
				<span class="text-muted-foreground tabular-nums"
					>ends ~{localTime(new Date(lastEnd), tz)}</span
				>
			{/if}
			<span class="text-muted-foreground tabular-nums"
				>{Math.floor(day.minutesLogged / 60)}h {day.minutesLogged % 60}m logged</span
			>
			{#if day.tomorrow.length}
				{@const first = day.tomorrow.find((j) => j.job.startsAt)}
				<span class="text-muted-foreground tabular-nums"
					>· tomorrow: <span class="font-semibold text-foreground">{day.tomorrow.length}</span>
					job{day.tomorrow.length === 1 ? '' : 's'}{#if first?.job.startsAt}
						— first at {localTime(first.job.startsAt, tz)}{/if}{#if tomorrowSchedMin > 0}
						· {Math.floor(tomorrowSchedMin / 60)}h {Math.round(tomorrowSchedMin % 60)}m sched{/if}</span
				>
			{/if}
		</div>
	{/if}

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

		{#if day.overdue.length}
			<h2 class="text-sm font-medium text-amber-600 dark:text-amber-500">
				Overdue ({day.overdue.length}) — still on your plate
			</h2>
			{#each day.overdue as j (j.job.id)}
				{@render jobCard(j)}
			{/each}
			<h2 class="text-sm font-medium text-muted-foreground">Today</h2>
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

		{#if day.materials.length}
			<Card.Root>
				<Card.Header><Card.Title class="text-base">Today's materials</Card.Title></Card.Header>
				<Card.Content class="px-0">
					<Table.Root>
						<Table.Body>
							{#each day.materials as m (m.name)}
								<Table.Row>
									<Table.Cell class="pl-6 font-medium"
										>{m.name}{#if m.sku}
											<span class="text-muted-foreground">· {m.sku}</span>{/if}</Table.Cell
									>
									<Table.Cell class="pr-6 text-right tabular-nums">{m.qty} {m.unit}</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</Card.Content>
			</Card.Root>
		{/if}

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

<Dialog.Root
	open={noteJobId !== null}
	onOpenChange={(v) => {
		if (!v) noteJobId = null;
	}}
>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Job note</Dialog.Title>
			<Dialog.Description>Logged to the job timeline — visible to the office.</Dialog.Description>
		</Dialog.Header>
		<Textarea rows={3} bind:value={noteText} placeholder="What should the office know?" />
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (noteJobId = null)}>Cancel</Button>
			<Button onclick={saveNote} disabled={pending !== null || !noteText.trim()}>Save note</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

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
