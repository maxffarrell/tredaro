<script lang="ts">
	import { page } from '$app/state';
	import PageHeader from '#lib/components/app/page-header.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import { toast } from 'svelte-sonner';
	import {
		getJob,
		updateJob,
		recordJobEvent,
		getJobTypes,
		getTechnicians
	} from '#lib/remote/jobs.remote.ts';
	import { getSettings, getOffices } from '#lib/remote/workspace.remote.ts';
	import { getCustomer } from '#lib/remote/customers.remote.ts';
	import { errMsg, formatDate, formatMoney, formatRelative } from '#lib/format.ts';
	import { localDate, localTime } from '#lib/tz.ts';
	import Truck from '@lucide/svelte/icons/truck';
	import Navigation from '@lucide/svelte/icons/navigation';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import FileText from '@lucide/svelte/icons/file-text';
	import Ban from '@lucide/svelte/icons/ban';

	const id = page.params.id!;
	const j = $derived(await getJob(id));
	const jobTypes = $derived(await getJobTypes());
	const technicians = $derived(await getTechnicians());
	const offices = $derived(await getOffices());
	const settings = $derived(await getSettings());
	const c = $derived(await getCustomer(j.job.customerId));
	const tz = $derived(settings.timezone);

	const locked = $derived(j.job.status === 'done' || j.job.status === 'cancelled');

	// ------- edit fields -------
	let jobTypeId = $state(j.job.jobTypeId ?? '');
	let technicianId = $state(j.job.technicianId ?? '');
	let officeId = $state(j.job.officeId ?? '');
	let serviceLocationId = $state(j.job.serviceLocationId ?? '');
	let summary = $state(j.job.summary);
	let description = $state(j.job.description);
	let priority = $state(j.job.priority);
	let startsAt = $state(
		j.job.startsAt
			? `${localDate(j.job.startsAt, settings.timezone)}T${localTime(j.job.startsAt, settings.timezone)}`
			: ''
	);
	let durationMin = $state(
		j.job.startsAt && j.job.endsAt
			? Math.round((j.job.endsAt.getTime() - j.job.startsAt.getTime()) / 60000)
			: 60
	);
	let pending = $state(false);

	async function save(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			await updateJob({
				id,
				jobTypeId: jobTypeId || null,
				technicianId: technicianId || null,
				officeId: officeId || null,
				serviceLocationId: serviceLocationId || null,
				summary,
				description,
				priority,
				startsAt: startsAt || null,
				durationMin
			});
			toast.success('Job saved');
		} catch (err) {
			toast.error(errMsg(err, 'Could not save'));
		}
		pending = false;
	}

	async function cancel() {
		try {
			await updateJob({ id, cancelled: true });
			toast.success('Job cancelled');
		} catch (err) {
			toast.error(errMsg(err, 'Could not cancel'));
		}
	}

	async function event(kind: 'dispatched' | 'en_route' | 'on_site' | 'completed') {
		try {
			await recordJobEvent({ jobId: id, kind });
			toast.success(kind === 'completed' ? 'Job done' : `Marked ${kind.replace('_', ' ')}`);
		} catch (err) {
			toast.error(errMsg(err, 'Could not update'));
		}
	}

	let note = $state('');
	async function addNote(e: SubmitEvent) {
		e.preventDefault();
		if (!note.trim()) return;
		try {
			await recordJobEvent({ jobId: id, kind: 'note', note });
			note = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not add note'));
		}
	}
</script>

<PageHeader
	title="J-{j.job.number} {j.job.summary || j.jobTypeName}"
	crumbs={[{ label: 'Jobs', href: '/jobs' }]}
>
	{#snippet actions()}
		<StatusBadge status={j.job.status} />
		{#if j.job.status === 'scheduled'}
			<Button size="sm" variant="outline" onclick={() => event('dispatched')}
				><Truck /> Dispatch</Button
			>
		{:else if j.job.status === 'dispatched'}
			<Button size="sm" variant="outline" onclick={() => event('en_route')}
				><Navigation /> En route</Button
			>
			<Button size="sm" variant="outline" onclick={() => event('on_site')}
				><MapPin /> On site</Button
			>
		{:else if j.job.status === 'in_progress'}
			<Button size="sm" onclick={() => event('completed')}><CircleCheck /> Complete</Button>
		{/if}
		{#if j.job.status === 'done' && j.openBalance === 0}
			<Button size="sm" href="/billing?invoiceFor={id}"><FileText /> Invoice</Button>
		{/if}
		{#if !locked}
			<Button size="sm" variant="ghost" class="text-destructive" onclick={cancel}><Ban /></Button>
		{/if}
	{/snippet}
</PageHeader>

<div class="grid gap-6 p-4 md:p-6 lg:grid-cols-3">
	<!-- details + edit form -->
	<div class="space-y-6 lg:col-span-2">
		<Card.Root>
			<Card.Header><Card.Title class="text-base">Details</Card.Title></Card.Header>
			<Card.Content>
				<form class="grid gap-4 sm:grid-cols-2" onsubmit={save}>
					<Field.Field>
						<Field.Label>Customer</Field.Label>
						<p class="pt-2 text-sm">
							<a href="/customers/{j.job.customerId}" class="font-medium hover:underline"
								>{j.customerName}</a
							>
							{#if j.companyName}<span class="text-muted-foreground"> · {j.companyName}</span>{/if}
						</p>
					</Field.Field>
					<Field.Field>
						<Field.Label>Location</Field.Label>
						<Select.Root type="single" bind:value={serviceLocationId}>
							<Select.Trigger class="w-full"
								>{c.locations.find((l) => l.id === serviceLocationId)
									? `${c.locations.find((l) => l.id === serviceLocationId)!.address1} ${c.locations.find((l) => l.id === serviceLocationId)!.city}`
									: j.address1
										? `${j.address1} ${j.city}`
										: 'On file'}</Select.Trigger
							>
							<Select.Content>
								{#each c.locations as l (l.id)}
									<Select.Item value={l.id}
										>{l.label ? `${l.label} — ` : ''}{l.address1}, {l.city}</Select.Item
									>
								{/each}
							</Select.Content>
						</Select.Root>
					</Field.Field>
					<Field.Field>
						<Field.Label>Job type</Field.Label>
						<Select.Root type="single" bind:value={jobTypeId}>
							<Select.Trigger class="w-full"
								>{jobTypes.find((t) => t.id === jobTypeId)?.name ?? 'None'}</Select.Trigger
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
					<Field.Field>
						<Field.Label>Office</Field.Label>
						<Select.Root type="single" bind:value={officeId}>
							<Select.Trigger class="w-full"
								>{offices.find((o) => o.id === officeId)?.name ?? 'None'}</Select.Trigger
							>
							<Select.Content>
								{#each offices.filter((o) => !o.archivedAt) as o (o.id)}
									<Select.Item value={o.id}>{o.name}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
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
					<Field.Field>
						<Field.Label for="d-start">Starts ({tz})</Field.Label>
						<Input id="d-start" type="datetime-local" bind:value={startsAt} disabled={locked} />
						<Field.Description
							>Clear the time to send this back to the unscheduled queue.</Field.Description
						>
					</Field.Field>
					<Field.Field>
						<Field.Label for="d-dur">Duration (minutes)</Field.Label>
						<Input
							id="d-dur"
							type="number"
							min={5}
							max={1440}
							bind:value={durationMin}
							disabled={locked}
						/>
					</Field.Field>
					<Field.Field class="sm:col-span-2">
						<Field.Label for="d-summary">Summary</Field.Label>
						<Input id="d-summary" bind:value={summary} disabled={locked} />
					</Field.Field>
					<Field.Field class="sm:col-span-2">
						<Field.Label for="d-desc">Notes</Field.Label>
						<Textarea id="d-desc" rows={4} bind:value={description} disabled={locked} />
					</Field.Field>
					{#if !locked}
						<div class="sm:col-span-2">
							<Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button>
						</div>
					{/if}
				</form>
			</Card.Content>
		</Card.Root>
	</div>

	<!-- timeline -->
	<div class="space-y-6">
		<Card.Root>
			<Card.Header><Card.Title class="text-base">Status</Card.Title></Card.Header>
			<Card.Content class="space-y-2 px-4 text-sm">
				<div class="flex justify-between">
					<span class="text-muted-foreground">Status</span><StatusBadge status={j.job.status} />
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Priority</span><StatusBadge status={j.job.priority} />
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Source</span><span class="capitalize"
						>{j.job.source}</span
					>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Scheduled</span><span
						>{j.job.startsAt
							? `${localDate(j.job.startsAt, tz)} ${localTime(j.job.startsAt, tz)}`
							: '—'}</span
					>
				</div>
				{#if j.job.completedAt}
					<div class="flex justify-between">
						<span class="text-muted-foreground">Completed</span><span
							>{formatDate(j.job.completedAt)}</span
						>
					</div>
				{/if}
				{#if j.job.estimateId}
					<div class="flex justify-between">
						<span class="text-muted-foreground">From estimate</span>
						<a href="/estimates/{j.job.estimateId}" class="hover:underline">View</a>
					</div>
				{/if}
				{#if j.openBalance > 0}
					<Separator />
					<div class="flex justify-between font-medium">
						<span>Open balance</span><span class="tabular-nums">{formatMoney(j.openBalance)}</span>
					</div>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header><Card.Title class="text-base">Timeline</Card.Title></Card.Header>
			<Card.Content class="px-4">
				<ul class="space-y-3">
					{#each j.events as e (e.event.id)}
						<li class="flex items-start gap-2 text-sm">
							<span class="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/40"></span>
							<div class="min-w-0">
								<p class="capitalize">
									{e.event.kind.replace('_', ' ')}
									{#if e.memberName}<span class="text-muted-foreground">· {e.memberName}</span>{/if}
								</p>
								{#if e.event.note}<p class="text-muted-foreground">{e.event.note}</p>{/if}
								<p class="text-xs text-muted-foreground">{formatRelative(e.event.at)}</p>
							</div>
						</li>
					{:else}
						<li class="text-sm text-muted-foreground">No activity yet.</li>
					{/each}
				</ul>
				{#if !locked}
					<form class="mt-4 flex gap-2" onsubmit={addNote}>
						<Input placeholder="Add a note…" bind:value={note} />
						<Button type="submit" variant="secondary" disabled={!note.trim()}>Add</Button>
					</form>
				{/if}
			</Card.Content>
		</Card.Root>
	</div>
</div>
