<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import PageHeader from '#lib/components/app/page-header.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { toast } from 'svelte-sonner';
	import {
		getJobs,
		getJobCounts,
		createJob,
		getJobTypes,
		getTechnicians
	} from '#lib/remote/jobs.remote.ts';
	import { getCustomers, getCustomer } from '#lib/remote/customers.remote.ts';
	import { getSettings } from '#lib/remote/workspace.remote.ts';
	import { getAiStatus, aiJobIntake, aiIntakeCreate } from '#lib/remote/ai.remote.ts';
	import { errMsg } from '#lib/format.ts';
	import { localDate, localTime } from '#lib/tz.ts';
	import Plus from '@lucide/svelte/icons/plus';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Download from '@lucide/svelte/icons/download';
	import Wrench from '@lucide/svelte/icons/wrench';

	const settings = await getSettings();
	const ai = await getAiStatus();
	const tz = settings.timezone;
	const jobTypes = await getJobTypes();
	const technicians = await getTechnicians();

	const customers = await getCustomers();

	const STATUS_TABS = [
		['all', 'All'],
		['unscheduled', 'Unscheduled'],
		['scheduled', 'Scheduled'],
		['dispatched', 'Dispatched'],
		['in_progress', 'In progress'],
		['done', 'Done'],
		['blocked', 'Blocked'],
		['cancelled', 'Cancelled']
	] as const;
	const now = $state(new Date());
	let tab = $state(page.url.searchParams.get('status') ?? 'all');
	let techId = $state(page.url.searchParams.get('tech') ?? '');
	let period = $state('');
	const localIso = (d: Date) => d.toLocaleDateString('en-CA');
	const periodRange = $derived.by((): { from?: string; to?: string } => {
		const now = new Date();
		if (period === 'today') {
			const t = localIso(now);
			return { from: t, to: localIso(new Date(now.getTime() + 86400_000)) };
		}
		if (period === 'week') {
			const day = (now.getDay() + 6) % 7; // Monday start
			const mon = now.getTime() - day * 86400_000;
			return { from: localIso(new Date(mon)), to: localIso(new Date(mon + 7 * 86400_000)) };
		}
		if (period === 'month')
			return {
				from: localIso(new Date(now.getFullYear(), now.getMonth(), 1)),
				to: localIso(new Date(now.getFullYear(), now.getMonth() + 1, 1))
			};
		if (period === '30d')
			return {
				from: localIso(new Date(now.getTime() - 30 * 86400_000)),
				to: localIso(new Date(now.getTime() + 86400_000))
			};
		return {};
	});
	const counts = $derived(await getJobCounts(techId ? { technicianId: techId } : undefined));
	const jobs = $derived(
		await getJobs(
			tab === 'all' && !techId && !period
				? undefined
				: {
						...(tab === 'all' || tab === 'blocked' ? {} : { status: [tab] }),
						...(tab === 'blocked' ? { blocked: true } : {}),
						...(techId ? { technicianId: techId } : {}),
						...periodRange
					}
		)
	);
	const uninvoicedCount = $derived(
		jobs.filter((j) => j.job.status === 'done' && !j.invoiced).length
	);
	const todayIso = new Date().toISOString().slice(0, 10);
	const todayCount = $derived(
		jobs.filter(
			(j) => j.job.startsAt && new Date(j.job.startsAt).toISOString().slice(0, 10) === todayIso
		).length
	);
	const unconfirmed = $derived(
		jobs.filter(
			(j) =>
				!j.confirmed &&
				(j.job.status === 'scheduled' || j.job.status === 'dispatched') &&
				j.job.startsAt &&
				new Date(j.job.startsAt) > new Date()
		).length
	);
	const unassignedCount = $derived(
		jobs.filter((j) => !j.job.technicianId && !['done', 'cancelled'].includes(j.job.status)).length
	);
	const partsCount = $derived(jobs.filter((j) => j.job.blocked).length);
	const urgentCount = $derived(
		tab === 'all' ? jobs.filter((j) => j.job.priority === 'urgent').length : 0
	);
	let tagFilter = $state('');
	const allTags = $derived([...new Set(jobs.flatMap((j) => j.job.tags ?? []))].sort() as string[]);
	const shownJobs = $derived(
		tagFilter ? jobs.filter((j) => j.job.tags?.includes(tagFilter)) : jobs
	);
	const overdueCount = $derived(
		jobs.filter(
			(j) =>
				j.job.startsAt &&
				new Date(j.job.startsAt) < now &&
				['scheduled', 'dispatched', 'in_progress'].includes(j.job.status)
		).length
	);

	// ------- AI intake -------
	let intakeOpen = $state(false);
	let intakeNotes = $state('');
	let intakePending = $state(false);
	let intakeCreating = $state(false);
	type IntakeDraft = {
		customer: { name: string; companyName: string; phone: string; email: string };
		address: { line1: string; city: string; state: string; zip: string } | null;
		jobTypeId: string | null;
		summary: string;
		description: string;
		priority: 'low' | 'normal' | 'high' | 'urgent';
	};
	let intakeDraft = $state<IntakeDraft | null>(null);
	let intakeMatchedId = $state<string | null>(null);
	let intakeMatchedName = $state('');
	async function runIntake() {
		intakePending = true;
		try {
			const r = await aiJobIntake({ notes: intakeNotes });
			intakeDraft = r.draft;
			intakeMatchedId = r.matchedCustomerId;
			intakeMatchedName = r.matchedCustomerName ?? '';
			if (!intakeUsable) toast.warning('Could not pull a job out of that — try fuller call notes');
		} catch (err) {
			toast.error(errMsg(err, 'Could not parse intake'));
		}
		intakePending = false;
	}
	const intakeUsable = $derived(
		!!(
			intakeDraft &&
			(intakeDraft.customer.name.trim() ||
				intakeDraft.customer.companyName.trim() ||
				intakeDraft.summary.trim())
		)
	);
	async function createIntakeJob() {
		if (!intakeDraft || !intakeUsable) return;
		intakeCreating = true;
		try {
			const r = await aiIntakeCreate({ draft: intakeDraft, matchedCustomerId: intakeMatchedId });
			toast.success('Job created');
			intakeOpen = false;
			intakeNotes = '';
			intakeDraft = null;
			intakeMatchedId = null;
			goto(`/jobs/${r.jobId}`);
		} catch (err) {
			toast.error(errMsg(err, 'Could not create job'));
		}
		intakeCreating = false;
	}

	// ------- new job -------
	let open = $state(page.url.searchParams.get('new') === '1');
	let pending = $state(false);
	let customerId = $state(page.url.searchParams.get('customer') ?? '');
	let jobTypeId = $state('');
	let technicianId = $state('');
	let techPrefilled = '';
	let locationId = $state<string | null>(null);
	function pickCustomer(v: string | undefined) {
		customerId = v ?? '';
		locationId = null;
		const pref = customers.find((c) => c.id === customerId)?.preferredMemberId ?? '';
		if (!technicianId || technicianId === techPrefilled) technicianId = pref;
		techPrefilled = pref;
	}
	let startsAt = $state('');
	let summary = $state('');
	let description = $state('');
	let priority = $state<'low' | 'normal' | 'high' | 'urgent'>('normal');
	let equipmentId = $state(page.url.searchParams.get('equipment') ?? 'none');
	const customerEquipment = $derived(
		customerId ? await getCustomer(customerId).then((c) => c.equipment) : []
	);
	const customerLocations = $derived(
		customerId ? await getCustomer(customerId).then((c) => c.locations) : []
	);
	const effectiveLocation = $derived(
		locationId ?? customerLocations.find((l) => l.isPrimary)?.id ?? customerLocations[0]?.id ?? ''
	);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			const j = await createJob({
				customerId,
				jobTypeId: jobTypeId || null,
				technicianId: technicianId || null,
				summary,
				description,
				priority,
				equipmentId: equipmentId === 'none' ? null : equipmentId || null,
				serviceLocationId: effectiveLocation || null,
				startsAt: startsAt || null
			}).updates(getJobs);
			toast.success(`Job J-${j!.number} created`);
			open = false;
			await goto(`/jobs/${j!.id}`);
		} catch (err) {
			toast.error(errMsg(err, 'Could not create job'));
		}
		pending = false;
	}
</script>

<PageHeader title="Jobs">
	{#snippet actions()}
		<Button size="sm" variant="outline" href="/api/export/jobs.csv" download
			><Download /> Export</Button
		>
		{#if ai.available}
			<Button size="sm" variant="outline" onclick={() => (intakeOpen = true)}
				><Sparkles /> AI intake</Button
			>
		{/if}
		<Button size="sm" onclick={() => (open = true)}><Plus /> New job</Button>
	{/snippet}
</PageHeader>

<div class="space-y-4 p-4 md:p-6">
	<div class="flex flex-wrap items-center gap-3">
		<Tabs.Root bind:value={tab} class="w-full min-w-0">
			<Tabs.List class="w-full flex-nowrap overflow-x-auto">
				{#each STATUS_TABS as [value, label] (value)}
					<Tabs.Trigger {value}
						>{label}{#if value !== 'all' && counts[value]}&nbsp;({counts[value]}){/if}</Tabs.Trigger
					>
				{/each}
			</Tabs.List>
		</Tabs.Root>
		{#if technicians.length}
			<Select.Root
				type="single"
				value={techId || 'all'}
				onValueChange={(v) => (techId = v === 'all' ? '' : v)}
			>
				<Select.Trigger class="h-8 w-44"
					>{techId
						? (technicians.find((t) => t.id === techId)?.name ?? 'Tech')
						: 'All techs'}</Select.Trigger
				>
				<Select.Content>
					<Select.Item value="all">All techs</Select.Item>
					{#each technicians as t (t.id)}
						<Select.Item value={t.id}>{t.name}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		{/if}
		<Select.Root
			type="single"
			value={period || 'any'}
			onValueChange={(v) => (period = v === 'any' ? '' : v)}
		>
			<Select.Trigger class="h-8 w-36"
				>{period === 'today'
					? 'Today'
					: period === 'week'
						? 'This week'
						: period === 'month'
							? 'This month'
							: period === '30d'
								? 'Last 30 days'
								: 'Any time'}</Select.Trigger
			>
			<Select.Content>
				<Select.Item value="any">Any time</Select.Item>
				<Select.Item value="today">Today</Select.Item>
				<Select.Item value="week">This week</Select.Item>
				<Select.Item value="month">This month</Select.Item>
				<Select.Item value="30d">Last 30 days</Select.Item>
			</Select.Content>
		</Select.Root>
		{#if unassignedCount}
			<Badge variant="outline" class="text-amber-600 dark:text-amber-400"
				>{unassignedCount} unassigned</Badge
			>
		{/if}
		{#if counts.in_progress}
			<Badge variant="outline" class="text-blue-600 dark:text-blue-400"
				>{counts.in_progress} in progress</Badge
			>
		{/if}
		{#if todayCount}
			<Badge variant="outline">{todayCount} today</Badge>
		{/if}
		{#if counts.doneThisMonth}
			<Badge variant="outline">{counts.doneThisMonth} done this month</Badge>
		{/if}
		{#if unconfirmed}
			<Badge variant="outline" class="text-amber-600 dark:text-amber-400"
				>{unconfirmed} unconfirmed</Badge
			>
		{/if}
		{#if uninvoicedCount}
			<Badge variant="outline" class="text-amber-600 dark:text-amber-400"
				>{uninvoicedCount} uninvoiced</Badge
			>
		{/if}
		{#if partsCount}
			<Badge class="border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-500"
				>{partsCount} waiting on parts</Badge
			>
		{/if}
		{#if urgentCount}
			<Badge class="border-transparent bg-red-500/15 text-red-600 dark:text-red-400"
				>{urgentCount} urgent</Badge
			>
		{/if}
		{#if overdueCount}
			<Badge class="border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-500"
				>{overdueCount} overdue</Badge
			>
		{/if}
	</div>

	{#if allTags.length}
		<div class="flex flex-wrap items-center gap-1.5">
			<span class="text-xs text-muted-foreground">Tags:</span>
			{#each allTags as t (t)}
				<Badge
					variant={tagFilter === t ? 'default' : 'outline'}
					class="cursor-pointer"
					onclick={() => (tagFilter = tagFilter === t ? '' : t)}>{t}</Badge
				>
			{/each}
		</div>
	{/if}

	<Card.Root class="py-0">
		<Card.Content class="overflow-x-auto px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Job</Table.Head>
						<Table.Head>Customer</Table.Head>
						<Table.Head class="hidden md:table-cell">When</Table.Head>
						<Table.Head class="hidden md:table-cell">Tech</Table.Head>
						<Table.Head>Status</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each shownJobs as j (j.job.id)}
						<Table.Row class="cursor-pointer" onclick={() => goto(`/jobs/${j.job.id}`)}>
							<Table.Cell class="font-medium">
								<span class="mr-2 inline-block size-2 rounded-full" style:background={j.color}
								></span>
								J-{j.job.number}
								{j.job.summary || j.jobTypeName}
								{#if j.job.source && j.job.source !== 'manual'}
									<Badge variant="outline" class="ml-1 capitalize">{j.job.source}</Badge>
								{/if}
								{#if j.job.priority === 'urgent' || j.job.priority === 'high'}
									<Badge
										variant="outline"
										class="ml-1 {j.job.priority === 'urgent'
											? 'border-red-500/40 text-red-600 dark:text-red-400'
											: 'border-amber-500/40 text-amber-600 dark:text-amber-400'}"
										>{j.job.priority}</Badge
									>
								{/if}
								{#each j.job.tags ?? [] as t (t)}
									<Badge variant="outline" class="ml-1 text-muted-foreground">{t}</Badge>
								{/each}
							</Table.Cell>
							<Table.Cell>{j.customerName}</Table.Cell>
							<Table.Cell class="hidden text-muted-foreground md:table-cell">
								{j.job.startsAt
									? `${localDate(j.job.startsAt, tz)} ${localTime(j.job.startsAt, tz)}`
									: '—'}
								{#if j.job.startsAt && j.job.startsAt < now && ['scheduled', 'dispatched', 'in_progress'].includes(j.job.status)}
									{@const days = Math.max(
										1,
										Math.floor((now.getTime() - new Date(j.job.startsAt).getTime()) / 86400_000)
									)}
									<Badge
										class="ml-1 border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-500"
										>{days}d overdue</Badge
									>
								{/if}
							</Table.Cell>
							<Table.Cell class="hidden text-muted-foreground md:table-cell"
								>{j.technicianName ?? '—'}</Table.Cell
							>
							<Table.Cell>
								<StatusBadge status={j.job.status} />
								{#if j.job.blocked}
									<Badge variant="outline" class="text-amber-600 dark:text-amber-400">parts</Badge>
								{/if}
								{#if j.job.warranty}
									<Badge variant="outline">warranty</Badge>
								{/if}
								{#if j.job.status === 'done' && !j.invoiced}
									<Badge
										class="ml-1 border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-500"
										>uninvoiced</Badge
									>
								{/if}
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell colspan={5}>
								<Empty.Root class="border-0">
									<Empty.Header>
										<Empty.Media><Wrench /></Empty.Media>
										<Empty.Title>No jobs</Empty.Title>
										<Empty.Description
											>Create the first job, or wait for one to come in from your booking page.</Empty.Description
										>
									</Empty.Header>
									<Empty.Content
										><Button onclick={() => (open = true)}>New job</Button></Empty.Content
									>
								</Empty.Root>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>
</div>

<Dialog.Root bind:open>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>New job</Dialog.Title>
			<Dialog.Description
				>Leave the time empty to park it in the unscheduled queue.</Dialog.Description
			>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={submit}>
			<Field.Field>
				<Field.Label>Customer</Field.Label>
				<Select.Root type="single" value={customerId} onValueChange={pickCustomer}>
					<Select.Trigger class="w-full"
						>{customers.find((c) => c.id === customerId)?.name ??
							'Choose a customer'}</Select.Trigger
					>
					<Select.Content>
						{#each customers as c (c.id)}
							<Select.Item value={c.id}>{c.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</Field.Field>
			{#if customerEquipment.length}
				<Field.Field>
					<Field.Label>Equipment</Field.Label>
					<Select.Root type="single" bind:value={equipmentId}>
						<Select.Trigger class="w-full"
							>{customerEquipment.find((e) => e.equipment.id === equipmentId)?.equipment.name ??
								'No unit'}</Select.Trigger
						>
						<Select.Content>
							<Select.Item value="none">No unit</Select.Item>
							{#each customerEquipment.filter((e) => e.equipment.active) as e (e.equipment.id)}
								<Select.Item value={e.equipment.id}
									>{e.equipment.name}{e.locationLabel ? ` · ${e.locationLabel}` : ''}</Select.Item
								>
							{/each}
						</Select.Content>
					</Select.Root>
				</Field.Field>
			{/if}
			{#if customerLocations.length}
				<Field.Field>
					<Field.Label>Service location</Field.Label>
					<Select.Root
						type="single"
						value={effectiveLocation}
						onValueChange={(v) => (locationId = v)}
					>
						<Select.Trigger class="w-full"
							>{(() => {
								const l = customerLocations.find((x) => x.id === effectiveLocation);
								return l
									? `${l.label ? `${l.label} — ` : ''}${l.address1 || 'No address'}`
									: 'Choose location';
							})()}</Select.Trigger
						>
						<Select.Content>
							{#each customerLocations as l (l.id)}
								<Select.Item value={l.id}
									>{l.label ? `${l.label} — ` : ''}{l.address1 || 'No address'}{l.isPrimary
										? ' · primary'
										: ''}</Select.Item
								>
							{/each}
						</Select.Content>
					</Select.Root>
				</Field.Field>
			{/if}
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<Field.Field>
					<Field.Label>Job type</Field.Label>
					<Select.Root type="single" bind:value={jobTypeId}>
						<Select.Trigger class="w-full"
							>{jobTypes.find((t) => t.id === jobTypeId)?.name ?? 'Optional'}</Select.Trigger
						>
						<Select.Content>
							{#each jobTypes.filter((t) => t.active) as t (t.id)}
								<Select.Item value={t.id}>{t.name}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</Field.Field>
				<Field.Field>
					<Field.Label>Technician</Field.Label>
					<Select.Root type="single" bind:value={technicianId}>
						<Select.Trigger class="w-full"
							>{technicians.find((t) => t.id === technicianId)?.name ??
								'Unassigned'}</Select.Trigger
						>
						<Select.Content>
							{#each technicians as t (t.id)}
								<Select.Item value={t.id}>{t.name}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</Field.Field>
			</div>
			<Field.Field>
				<Field.Label for="j-start">Starts (workspace time)</Field.Label>
				<Input id="j-start" type="datetime-local" bind:value={startsAt} />
			</Field.Field>
			<Field.Field>
				<Field.Label for="j-summary">Summary</Field.Label>
				<Input id="j-summary" bind:value={summary} placeholder="Defaults to the job type" />
			</Field.Field>
			<Field.Field>
				<Field.Label for="j-desc">Notes</Field.Label>
				<Textarea id="j-desc" rows={3} bind:value={description} />
			</Field.Field>
			<Field.Field>
				<Field.Label>Priority</Field.Label>
				<Select.Root type="single" bind:value={priority}>
					<Select.Trigger class="w-full">{priority}</Select.Trigger>
					<Select.Content>
						{#each ['low', 'normal', 'high', 'urgent'] as p (p)}
							<Select.Item value={p}>{p}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</Field.Field>
			<Dialog.Footer>
				<Button type="submit" disabled={pending || !customerId}
					>{pending ? 'Creating…' : 'Create job'}</Button
				>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<!-- AI job intake -->
<Dialog.Root bind:open={intakeOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>AI job intake</Dialog.Title>
			<Dialog.Description>
				Paste call notes, a voicemail transcript, or a forwarded email — the model drafts the
				customer and job for review.
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-3">
			<Textarea
				rows={6}
				placeholder="e.g. Maria at 512-555-0143, 420 Live Oak Dr, AC blowing warm air since yesterday, wants someone this week…"
				bind:value={intakeNotes}
			/>
			<Button
				variant="secondary"
				disabled={intakePending || intakeNotes.trim().length < 5}
				onclick={runIntake}><Sparkles /> {intakePending ? 'Parsing…' : 'Parse'}</Button
			>
			{#if intakeDraft}
				<div class="space-y-2 rounded-lg border p-3 text-sm">
					{#if intakeMatchedId}
						<p class="text-xs text-muted-foreground">
							Matches existing customer <span class="font-medium text-foreground"
								>{intakeMatchedName}</span
							> — a new customer won't be created.
						</p>
					{/if}
					<div class="grid grid-cols-2 gap-x-3 gap-y-1">
						<span class="text-muted-foreground">Customer</span>
						<span class="font-medium"
							>{intakeDraft.customer.name || intakeDraft.customer.companyName || '—'}</span
						>
						<span class="text-muted-foreground">Phone</span>
						<span>{intakeDraft.customer.phone || '—'}</span>
						<span class="text-muted-foreground">Email</span>
						<span>{intakeDraft.customer.email || '—'}</span>
						{#if intakeDraft.address}
							<span class="text-muted-foreground">Address</span>
							<span
								>{[
									intakeDraft.address.line1,
									intakeDraft.address.city,
									intakeDraft.address.state,
									intakeDraft.address.zip
								]
									.filter(Boolean)
									.join(', ') || '—'}</span
							>
						{/if}
					</div>
					<Field.Field>
						<Field.Label>Job type</Field.Label>
						<Select.Root
							type="single"
							value={intakeDraft.jobTypeId ?? ''}
							onValueChange={(v) => {
								if (intakeDraft) intakeDraft.jobTypeId = v || null;
							}}
						>
							<Select.Trigger class="w-full"
								>{jobTypes.find((t) => t.id === intakeDraft?.jobTypeId)?.name ??
									'No type'}</Select.Trigger
							>
							<Select.Content>
								<Select.Item value="">No type</Select.Item>
								{#each jobTypes as t (t.id)}
									<Select.Item value={t.id}>{t.name}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</Field.Field>
					<Field.Field>
						<Field.Label for="intake-summary">Summary</Field.Label>
						<Input id="intake-summary" bind:value={intakeDraft.summary} />
					</Field.Field>
					<div class="flex items-center gap-2">
						<Badge variant="outline" class="capitalize">{intakeDraft.priority}</Badge>
						{#if intakeDraft.description}
							<span class="truncate text-xs text-muted-foreground" title={intakeDraft.description}
								>{intakeDraft.description}</span
							>
						{/if}
					</div>
				</div>
			{/if}
		</div>
		{#if intakeDraft && intakeUsable}
			<Dialog.Footer>
				<Button disabled={intakeCreating} onclick={createIntakeJob}
					>{intakeCreating ? 'Creating…' : 'Create job'}</Button
				>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
