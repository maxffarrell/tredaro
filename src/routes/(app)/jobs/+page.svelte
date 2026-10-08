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
	import { errMsg } from '#lib/format.ts';
	import { localDate, localTime } from '#lib/tz.ts';
	import Plus from '@lucide/svelte/icons/plus';
	import Download from '@lucide/svelte/icons/download';
	import Wrench from '@lucide/svelte/icons/wrench';

	const settings = await getSettings();
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
		['blocked', 'Blocked']
	] as const;
	const now = $state(new Date());
	let tab = $state(page.url.searchParams.get('status') ?? 'all');
	let techId = $state(page.url.searchParams.get('tech') ?? '');
	const counts = $derived(await getJobCounts(techId ? { technicianId: techId } : undefined));
	const jobs = $derived(
		await getJobs(
			tab === 'all' && !techId
				? undefined
				: {
						...(tab === 'all' || tab === 'blocked' ? {} : { status: [tab] }),
						...(tab === 'blocked' ? { blocked: true } : {}),
						...(techId ? { technicianId: techId } : {})
					}
		)
	);

	// ------- new job -------
	let open = $state(page.url.searchParams.get('new') === '1');
	let pending = $state(false);
	let customerId = $state(page.url.searchParams.get('customer') ?? '');
	let jobTypeId = $state('');
	let technicianId = $state('');
	let techPrefilled = '';
	function pickCustomer(v: string | undefined) {
		customerId = v ?? '';
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
		<Button size="sm" onclick={() => (open = true)}><Plus /> New job</Button>
	{/snippet}
</PageHeader>

<div class="space-y-4 p-4 md:p-6">
	<div class="flex flex-wrap items-center gap-3">
		<Tabs.Root bind:value={tab}>
			<Tabs.List class="flex-wrap">
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
	</div>

	<Card.Root class="py-0">
		<Card.Content class="px-0">
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
					{#each jobs as j (j.job.id)}
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
							</Table.Cell>
							<Table.Cell>{j.customerName}</Table.Cell>
							<Table.Cell class="hidden text-muted-foreground md:table-cell">
								{j.job.startsAt
									? `${localDate(j.job.startsAt, tz)} ${localTime(j.job.startsAt, tz)}`
									: '—'}
								{#if j.job.startsAt && j.job.startsAt < now && ['scheduled', 'dispatched', 'in_progress'].includes(j.job.status)}
									<Badge
										class="ml-1 border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-500"
										>overdue</Badge
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
			<div class="grid gap-4 sm:grid-cols-2">
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
