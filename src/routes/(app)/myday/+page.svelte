<script lang="ts">
	import CalendarX2 from '@lucide/svelte/icons/calendar-x-2';
	import * as Alert from '#lib/components/ui/alert/index.js';
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
		addJobExpense,
		signJob,
		startTimer,
		stopTimer,
		getCalendarFeed,
		requestTimeOff
	} from '#lib/remote/jobs.remote.ts';
	import { textCustomerCmd } from '#lib/remote/customers.remote.ts';
	import { getCustomerOpenBalance, recordPayment } from '#lib/remote/billing.remote.ts';
	import { getSettings } from '#lib/remote/workspace.remote.ts';
	import { getTruckStock, addJobMaterial } from '#lib/remote/inventory.remote.ts';
	import Package from '@lucide/svelte/icons/package';
	import SignatureDialog from '#lib/components/app/signature-dialog.svelte';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import MoneyInput from '#lib/components/app/money-input.svelte';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { errMsg, formatMoney } from '#lib/format.ts';
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
	import Flag from '@lucide/svelte/icons/flag';
	import Phone from '@lucide/svelte/icons/phone';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import Camera from '@lucide/svelte/icons/camera';
	import Receipt from '@lucide/svelte/icons/receipt';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import HandCoins from '@lucide/svelte/icons/hand-coins';

	const settings = await getSettings();
	const currency = settings.currency;
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
	let signNote = $state('');

	// ------- request time off -------
	let ptoOpen = $state(false);
	let ptoStart = $state('');
	let ptoEnd = $state('');
	let ptoReason = $state('');
	let ptoPending = $state(false);
	async function saveTimeOff() {
		ptoPending = true;
		try {
			await requestTimeOff({
				startsOn: ptoStart,
				endsOn: ptoEnd,
				reason: ptoReason.trim()
			});
			ptoOpen = false;
			ptoReason = '';
			toast.success('Time off marked');
		} catch (err) {
			toast.error(errMsg(err, 'Could not save'));
		}
		ptoPending = false;
	}
	let noteJobId = $state<string | null>(null);
	let expJobId = $state<string | null>(null);
	let expDesc = $state('');
	let expVendor = $state('');
	let expAmount = $state(0);
	let textCustomerId = $state<string | null>(null);
	let textMsg = $state('');
	let collectCustomerId = $state<string | null>(null);
	let collectAmount = $state(0);
	let collectMethod = $state('cash');
	let collectNotes = $state('');
	const collectBal = $derived(
		collectCustomerId ? await getCustomerOpenBalance(collectCustomerId) : null
	);
	let noteText = $state('');

	// photo capture — one shared input; the menu sets the job + phase, then clicks it
	let photoJobId = $state<string | null>(null);
	let photoPhase = $state<'before' | 'during' | 'after'>('during');
	let photoInput: HTMLInputElement;
	let uploadingPhoto = $state<string | null>(null);
	function pickPhoto(jobId: string, phase: 'before' | 'during' | 'after') {
		photoJobId = jobId;
		photoPhase = phase;
		photoInput?.click();
	}
	async function uploadPhoto(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		const jobId = photoJobId;
		if (!file || !jobId) return;
		uploadingPhoto = jobId;
		try {
			const form = new FormData();
			form.set('file', file);
			form.set('phase', photoPhase);
			const res = await fetch(`/api/jobs/${jobId}/photos`, { method: 'POST', body: form });
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				throw new Error(body?.message ?? `Upload failed (${res.status})`);
			}
			toast.success(`${photoPhase[0].toUpperCase()}${photoPhase.slice(1)} photo added`);
		} catch (err) {
			toast.error(errMsg(err, 'Could not upload photo'));
		}
		(e.currentTarget as HTMLInputElement).value = '';
		uploadingPhoto = null;
	}

	async function saveExpense() {
		if (!expJobId || !expDesc.trim() || expAmount <= 0) return;
		try {
			await addJobExpense({
				jobId: expJobId,
				description: expDesc.trim(),
				vendor: expVendor.trim(),
				amount: expAmount
			}).updates(getMyDay);
			toast.success('Expense logged — the office can bill it');
			expJobId = null;
			expDesc = '';
			expVendor = '';
			expAmount = 0;
		} catch (err) {
			toast.error(errMsg(err, 'Could not log expense'));
		}
	}

	async function sendText() {
		if (!textCustomerId || !textMsg.trim()) return;
		try {
			await textCustomerCmd({ customerId: textCustomerId, message: textMsg.trim() });
			toast.success('Text sent');
			textCustomerId = null;
			textMsg = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not send text'));
		}
	}

	async function collect() {
		if (!collectCustomerId || collectAmount <= 0) return;
		try {
			await recordPayment({
				customerId: collectCustomerId,
				amount: collectAmount,
				method: collectMethod as 'card' | 'cash' | 'check' | 'bank' | 'stripe' | 'other',
				notes: collectNotes.trim() || undefined
			});
			toast.success('Payment recorded');
			collectCustomerId = null;
			collectAmount = 0;
			collectNotes = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not record payment'));
		}
	}

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

	// ------- log a part used from my truck -------
	const myTruck = $derived(
		day.member
			? (await getTruckStock()).filter(
					(t) => t.stock.memberId === day.member!.id && t.stock.qty > 0
				)
			: []
	);
	let partJobId = $state<string | null>(null);
	let partItemId = $state('');
	let partQty = $state(1);
	function openPart(jobId: string) {
		partJobId = jobId;
		partItemId = '';
		partQty = 1;
	}
	async function logPart() {
		if (!partJobId || !partItemId || !day.member) return;
		pending = `${partJobId}:part`;
		try {
			await addJobMaterial({
				jobId: partJobId,
				inventoryItemId: partItemId,
				qty: partQty,
				unitPrice: 0,
				truckMemberId: day.member.id
			}).updates(getMyDay);
			partJobId = null;
			toast.success('Part logged from your truck');
		} catch (err) {
			toast.error(errMsg(err, 'Could not log part'));
		}
		pending = null;
	}

	// ------- wrap up: stop any running timer, then show the day summary -------
	let wrapOpen = $state(false);
	let wrapPending = $state(false);
	async function wrapUp() {
		wrapPending = true;
		try {
			if (day.openEntry) {
				await stopTimer(day.openEntry.entry.jobId).updates(getMyDay);
				toast.success('Timer stopped');
			}
			wrapOpen = true;
		} catch (err) {
			toast.error(errMsg(err, 'Could not stop timer'));
		}
		wrapPending = false;
	}

	async function completeWithSignature(name: string, dataUrl: string) {
		const jobId = signJobId;
		if (!jobId) return;
		pending = `${jobId}:completed`;
		const note = signNote;
		signNote = '';
		try {
			await signJob({ jobId, name, signature: dataUrl });
			signJobId = null;
			await recordJobEvent({ jobId, kind: 'completed', note: note || null }).updates(getMyDay);
			toast.success('Job done');
		} catch (err) {
			toast.error(errMsg(err, 'Could not update'));
		}
		pending = null;
	}

	async function advance(jobId: string, kind: EventKind, note?: string) {
		pending = `${jobId}:${kind}`;
		try {
			await recordJobEvent({ jobId, kind, note: note || null }).updates(getMyDay);
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
					{#if j.job.arrivalWindow}
						<p class="truncate text-xs font-medium">Arrive {j.job.arrivalWindow}</p>
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
				{#if j.job.warranty}
					<Badge variant="outline">warranty</Badge>
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
						title="Log a job expense (permit, parking, misc)"
						onclick={() => (expJobId = j.job.id)}><Receipt /> Expense</Button
					>
					{#if j.customerPhone}
						<Button
							size="sm"
							variant="ghost"
							disabled={pending !== null}
							title="Text the customer"
							onclick={() => (textCustomerId = j.job.customerId)}><MessageSquare /> Text</Button
						>
					{/if}
					<Button
						size="sm"
						variant="ghost"
						disabled={pending !== null}
						title="Collect a payment on site"
						onclick={() => (collectCustomerId = j.job.customerId)}><HandCoins /> Collect</Button
					>
					<DropdownMenu.Root>
						<DropdownMenu.Trigger>
							{#snippet child({ props })}
								<Button
									{...props}
									size="sm"
									variant="ghost"
									disabled={pending !== null || uploadingPhoto === j.job.id}
								>
									<Camera />
									{uploadingPhoto === j.job.id ? 'Uploading…' : 'Photo'}
								</Button>
							{/snippet}
						</DropdownMenu.Trigger>
						<DropdownMenu.Content align="start">
							<DropdownMenu.Item onclick={() => pickPhoto(j.job.id, 'before')}
								>Before photo</DropdownMenu.Item
							>
							<DropdownMenu.Item onclick={() => pickPhoto(j.job.id, 'during')}
								>During photo</DropdownMenu.Item
							>
							<DropdownMenu.Item onclick={() => pickPhoto(j.job.id, 'after')}
								>After photo</DropdownMenu.Item
							>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
					{#if myTruck.length}
						<Button
							size="sm"
							variant="ghost"
							disabled={pending !== null}
							onclick={() => openPart(j.job.id)}><Package /> Part</Button
						>
					{/if}
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
	<Button
		variant="outline"
		size="sm"
		onclick={() => (ptoOpen = true)}
		title="Mark upcoming time off — shows on dispatch"
	>
		<CalendarX2 /> Time off
	</Button>
	{#if calFeed}
		<Button variant="outline" size="sm" onclick={copyCal} title="Subscribe to your schedule">
			<CalendarPlus /> Calendar
		</Button>
	{/if}
	{#if day.member && (day.jobs.length || day.openEntry)}
		<Button
			variant="outline"
			size="sm"
			onclick={wrapUp}
			disabled={wrapPending}
			title="Stop the timer and review your day"
		>
			<Flag />
			{wrapPending ? 'Wrapping…' : 'Wrap up'}
		</Button>
	{/if}
{/snippet}

<PageHeader title="My Day" actions={calActions} />

<div class="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 md:p-6">
	<p class="text-sm text-muted-foreground">
		{new Date(`${day.today}T12:00:00Z`).toLocaleDateString('en-US', {
			weekday: 'long',
			month: 'long',
			day: 'numeric',
			timeZone: 'UTC'
		})}
	</p>

	{#if day.offToday}
		<Alert.Root
			class="border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/40 dark:bg-amber-950/30"
		>
			<CalendarX2 />
			<Alert.Title
				>You're off today{day.offToday.reason ? `: ${day.offToday.reason}` : ''}.</Alert.Title
			>
			<Alert.Description
				>Anything below was already on your schedule — coordinate with the office if it needs
				reassigning.</Alert.Description
			>
		</Alert.Root>
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
			{#if day.materials?.length}
				<span class="text-muted-foreground tabular-nums"
					>pull {day.materials.reduce((m, x) => m + x.qty, 0)} item{day.materials.reduce(
						(m, x) => m + x.qty,
						0
					) === 1
						? ''
						: 's'}</span
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
					>{Math.floor(schedMin / 60)}h {Math.round(schedMin % 60)}m scheduled{#if day.jobs.length > 1}
						· avg {Math.round(schedMin / day.jobs.length / 60)}h {Math.round(
							(schedMin / day.jobs.length) % 60
						)}m/job{/if}</span
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
				<Card.Content class="overflow-x-auto px-0">
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

<Dialog.Root
	open={partJobId !== null}
	onOpenChange={(v) => {
		if (!v) partJobId = null;
	}}
>
	<Dialog.Content class="sm:max-w-xs">
		<Dialog.Header>
			<Dialog.Title>Log part used</Dialog.Title>
			<Dialog.Description
				>Comes off your truck stock — bill it on the invoice later.</Dialog.Description
			>
		</Dialog.Header>
		<div class="grid gap-3">
			<Select.Root type="single" value={partItemId} onValueChange={(v) => (partItemId = v ?? '')}>
				<Select.Trigger class="w-full" data-testid="part-item"
					>{myTruck.find((t) => t.stock.inventoryItemId === partItemId)?.itemName ??
						'Pick a part'}</Select.Trigger
				>
				<Select.Content>
					{#each myTruck as t (t.stock.id)}
						<Select.Item value={t.stock.inventoryItemId}
							>{t.itemName} — {t.stock.qty} {t.itemUnit} on truck</Select.Item
						>
					{/each}
				</Select.Content>
			</Select.Root>
			<Label class="grid gap-1 text-xs">
				Qty
				<Input type="number" min="1" bind:value={partQty} data-testid="part-qty" />
			</Label>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (partJobId = null)}>Cancel</Button>
			<Button onclick={logPart} disabled={pending !== null || !partItemId || partQty < 1}
				>Log part</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={ptoOpen}>
	<Dialog.Content class="sm:max-w-xs">
		<Dialog.Header>
			<Dialog.Title>Request time off</Dialog.Title>
			<Dialog.Description
				>Blocked on the dispatch board immediately — the office is emailed a heads-up.</Dialog.Description
			>
		</Dialog.Header>
		<div class="grid gap-3">
			<div class="grid gap-1.5">
				<Label for="pto-start">From</Label>
				<Input id="pto-start" type="date" bind:value={ptoStart} />
			</div>
			<div class="grid gap-1.5">
				<Label for="pto-end">To</Label>
				<Input id="pto-end" type="date" bind:value={ptoEnd} />
			</div>
			<div class="grid gap-1.5">
				<Label for="pto-reason">Reason (optional)</Label>
				<Input id="pto-reason" bind:value={ptoReason} placeholder="PTO, appointment…" />
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (ptoOpen = false)}>Cancel</Button>
			<Button onclick={saveTimeOff} disabled={ptoPending || !ptoStart || !ptoEnd}
				>{ptoPending ? 'Saving…' : 'Mark off'}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<input
	bind:this={photoInput}
	type="file"
	accept="image/*"
	capture="environment"
	class="hidden"
	onchange={uploadPhoto}
/>

<SignatureDialog
	bind:open={() => signJobId !== null, (v) => (signJobId = v ? signJobId : null)}
	pending={pending !== null}
	onSave={completeWithSignature}
	skipLabel="Complete without signature"
	bind:note={signNote}
	onSkip={() => {
		const jobId = signJobId;
		signJobId = null;
		const note = signNote;
		signNote = '';
		if (jobId) advance(jobId, 'completed', note);
	}}
/>

<Dialog.Root
	open={expJobId !== null}
	onOpenChange={(v) => {
		if (!v) expJobId = null;
	}}
>
	<Dialog.Content class="sm:max-w-xs">
		<Dialog.Header>
			<Dialog.Title>Job expense</Dialog.Title>
			<Dialog.Description
				>Permits, parking, subcontractors — billable on the job's invoice.</Dialog.Description
			>
		</Dialog.Header>
		<div class="space-y-3">
			<div class="space-y-1.5">
				<Label for="exp-desc">Description</Label>
				<Input id="exp-desc" bind:value={expDesc} placeholder="Permit fee" />
			</div>
			<div class="space-y-1.5">
				<Label for="exp-vendor">Vendor (optional)</Label>
				<Input id="exp-vendor" bind:value={expVendor} placeholder="City of Austin" />
			</div>
			<div class="space-y-1.5">
				<Label for="exp-amt">Amount</Label>
				<MoneyInput id="exp-amt" bind:value={expAmount} />
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (expJobId = null)}>Cancel</Button>
			<Button onclick={saveExpense} disabled={!expDesc.trim() || expAmount <= 0}>Log expense</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root
	open={textCustomerId !== null}
	onOpenChange={(v) => {
		if (!v) textCustomerId = null;
	}}
>
	<Dialog.Content class="sm:max-w-xs">
		<Dialog.Header>
			<Dialog.Title>Text the customer</Dialog.Title>
			<Dialog.Description
				>Sends from your company's number — replies land in the inbox.</Dialog.Description
			>
		</Dialog.Header>
		<Textarea rows={3} bind:value={textMsg} placeholder="Running about 15 minutes behind…" />
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (textCustomerId = null)}>Cancel</Button>
			<Button onclick={sendText} disabled={!textMsg.trim()}>Send text</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root
	open={collectCustomerId !== null}
	onOpenChange={(v) => {
		if (!v) collectCustomerId = null;
	}}
>
	<Dialog.Content class="sm:max-w-xs">
		<Dialog.Header>
			<Dialog.Title>Collect payment</Dialog.Title>
			<Dialog.Description>
				{#if collectBal?.count}
					{collectBal.count} open charge{collectBal.count === 1 ? '' : 's'} — balance {formatMoney(
						collectBal.open,
						currency
					)}. Applies oldest-first.
				{:else}
					Nothing owed — record anyway to log a prepayment credit.
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-3">
			<div class="space-y-1.5">
				<Label for="collect-amt">Amount</Label>
				<MoneyInput id="collect-amt" bind:value={collectAmount} />
				{#if collectBal?.open}
					<Button
						variant="link"
						class="h-auto p-0 text-xs"
						onclick={() => (collectAmount = collectBal!.open)}>Fill full balance</Button
					>
				{/if}
			</div>
			<div class="space-y-1.5">
				<Label>Method</Label>
				<Select.Root type="single" bind:value={collectMethod}>
					<Select.Trigger class="h-8 w-full">{collectMethod}</Select.Trigger>
					<Select.Content>
						{#each ['cash', 'check', 'card', 'bank', 'other'] as m (m)}
							<Select.Item value={m} class="capitalize">{m}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
			<div class="space-y-1.5">
				<Label for="collect-notes">Notes (optional)</Label>
				<Input id="collect-notes" bind:value={collectNotes} placeholder="Check #1234" />
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (collectCustomerId = null)}>Cancel</Button>
			<Button onclick={collect} disabled={collectAmount <= 0}>Record payment</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={wrapOpen}>
	<Dialog.Content class="sm:max-w-xs">
		<Dialog.Header>
			<Dialog.Title>Day wrap-up</Dialog.Title>
			<Dialog.Description>{day.today} — your numbers for the office.</Dialog.Description>
		</Dialog.Header>
		{@const doneJobs = day.jobs.filter((j) => j.job.status === 'done')}
		<div class="space-y-2 text-sm">
			<div class="flex justify-between">
				<span class="text-muted-foreground">Jobs completed</span>
				<span class="font-medium">{doneJobs.length} / {day.jobs.length}</span>
			</div>
			<div class="flex justify-between">
				<span class="text-muted-foreground">Time logged</span>
				<span class="font-medium tabular-nums"
					>{Math.floor((day.minutesLogged ?? 0) / 60)}h {(day.minutesLogged ?? 0) % 60}m</span
				>
			</div>
			<div class="flex justify-between">
				<span class="text-muted-foreground">Timer still running</span>
				<span class="font-medium"
					>{day.openEntry ? 'Yes — J-' + day.openEntry.jobNumber : 'No'}</span
				>
			</div>
			{#if day.materials?.length}
				<div class="border-t pt-2">
					<p class="mb-1 text-xs font-medium text-muted-foreground">Parts used</p>
					{#each day.materials as m (m.sku + m.name)}
						<div class="flex justify-between text-sm">
							<span class="truncate">{m.name}</span>
							<span class="tabular-nums">{m.qty} {m.unit}</span>
						</div>
					{/each}
				</div>
			{/if}
			{#if day.tomorrow?.length}
				<p class="border-t pt-2 text-xs text-muted-foreground">
					Tomorrow: {day.tomorrow.length} job{day.tomorrow.length === 1 ? '' : 's'} on the board.
				</p>
			{/if}
		</div>
		<Dialog.Footer>
			<Button onclick={() => (wrapOpen = false)}>Done</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
