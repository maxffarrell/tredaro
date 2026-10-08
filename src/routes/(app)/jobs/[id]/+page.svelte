<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import PageHeader from '#lib/components/app/page-header.svelte';
	import MoneyInput from '#lib/components/app/money-input.svelte';
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
		getJobs,
		getDispatchBoard,
		updateJob,
		recordJobEvent,
		getJobTypes,
		getTechnicians,
		getTimeEntries,
		startTimer,
		stopTimer,
		addTimeEntry,
		deleteTimeEntry,
		createJob
	} from '#lib/remote/jobs.remote.ts';
	import { getSettings, getOffices } from '#lib/remote/workspace.remote.ts';
	import { getCustomer } from '#lib/remote/customers.remote.ts';
	import {
		getInventory,
		getJobMaterials,
		addJobMaterial,
		removeJobMaterial
	} from '#lib/remote/inventory.remote.ts';
	import {
		getJobChecklist,
		addChecklistItem,
		toggleChecklistItem,
		deleteChecklistItem,
		getJobPhotos,
		deleteJobPhoto
	} from '#lib/remote/jobs.remote.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { errMsg, formatDate, formatMoney, formatRelative } from '#lib/format.ts';
	import { localDate, localTime } from '#lib/tz.ts';
	import Truck from '@lucide/svelte/icons/truck';
	import Navigation from '@lucide/svelte/icons/navigation';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import FileText from '@lucide/svelte/icons/file-text';
	import Ban from '@lucide/svelte/icons/ban';
	import Timer from '@lucide/svelte/icons/timer';
	import Package from '@lucide/svelte/icons/package';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import Camera from '@lucide/svelte/icons/camera';
	import Repeat from '@lucide/svelte/icons/repeat';
	import Play from '@lucide/svelte/icons/play';
	import Square from '@lucide/svelte/icons/square';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Plus from '@lucide/svelte/icons/plus';

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
	let equipmentId = $state(j.job.equipmentId ?? '');
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
				equipmentId: equipmentId || null,
				summary,
				description,
				priority,
				startsAt: startsAt || null,
				durationMin
			}).updates(getJob, getJobs, getDispatchBoard);
			toast.success('Job saved');
		} catch (err) {
			toast.error(errMsg(err, 'Could not save'));
		}
		pending = false;
	}

	async function cancel() {
		try {
			await updateJob({ id, cancelled: true }).updates(getJob, getJobs, getDispatchBoard);
			toast.success('Job cancelled');
		} catch (err) {
			toast.error(errMsg(err, 'Could not cancel'));
		}
	}

	async function event(kind: 'dispatched' | 'en_route' | 'on_site' | 'completed') {
		try {
			await recordJobEvent({ jobId: id, kind }).updates(getJob, getJobs, getDispatchBoard);
			toast.success(kind === 'completed' ? 'Job done' : `Marked ${kind.replace('_', ' ')}`);
		} catch (err) {
			toast.error(errMsg(err, 'Could not update'));
		}
	}

	// ------- checklist -------
	const checklist = $derived(await getJobChecklist(id));
	const checkDone = $derived(checklist.filter((i) => i.done).length);
	let newCheck = $state('');
	async function addCheck(e: SubmitEvent) {
		e.preventDefault();
		const label = newCheck.trim();
		if (!label) return;
		try {
			await addChecklistItem({ jobId: id, label }).updates(getJobChecklist);
			newCheck = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not add item'));
		}
	}
	async function toggleCheck(item: (typeof checklist)[number]) {
		try {
			await toggleChecklistItem({ id: item.id, done: !item.done }).updates(getJobChecklist);
		} catch (err) {
			toast.error(errMsg(err, 'Could not update item'));
		}
	}
	async function delCheck(itemId: string) {
		try {
			await deleteChecklistItem(itemId).updates(getJobChecklist);
		} catch (err) {
			toast.error(errMsg(err, 'Could not remove item'));
		}
	}

	// ------- time tracking -------
	const time = $derived(await getTimeEntries(id));
	const minutes = (e: { startedAt: Date; endedAt: Date | null }) =>
		Math.max(0, Math.round(((e.endedAt ?? new Date()).getTime() - e.startedAt.getTime()) / 60000));
	const fmtDur = (min: number) =>
		min >= 60 ? `${Math.floor(min / 60)}h ${min % 60 ? `${min % 60}m` : ''}`.trim() : `${min}m`;
	const totalMin = $derived(time.entries.reduce((s, e) => s + minutes(e.entry), 0));

	async function toggleTimer() {
		try {
			if (time.mine) await stopTimer(id).updates(getTimeEntries);
			else await startTimer(id).updates(getTimeEntries);
		} catch (err) {
			toast.error(errMsg(err, 'Could not update timer'));
		}
	}

	let addingTime = $state(false);
	let teMember = $state('');
	let teStart = $state('');
	let teEnd = $state('');
	let teNote = $state('');
	async function logTime(e: SubmitEvent) {
		e.preventDefault();
		try {
			await addTimeEntry({
				jobId: id,
				memberId: teMember || null,
				startedAt: teStart,
				endedAt: teEnd || null,
				note: teNote
			}).updates(getTimeEntries);
			addingTime = false;
			teStart = teEnd = teNote = '';
			teMember = '';
			toast.success('Time logged');
		} catch (err) {
			toast.error(errMsg(err, 'Could not log time'));
		}
	}
	async function removeTime(entryId: string) {
		try {
			await deleteTimeEntry({ id: entryId, jobId: id }).updates(getTimeEntries);
		} catch (err) {
			toast.error(errMsg(err, 'Could not delete'));
		}
	}

	// ------- materials -------
	const materials = $derived(await getJobMaterials({ jobId: id }));

	// ------- photos -------
	const photos = $derived(await getJobPhotos(id));
	let uploading = $state(false);
	async function uploadPhoto(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		uploading = true;
		try {
			const form = new FormData();
			form.set('file', file);
			const res = await fetch(`/api/jobs/${id}/photos`, { method: 'POST', body: form });
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				throw new Error(body?.message ?? `Upload failed (${res.status})`);
			}
			await getJobPhotos(id).refresh();
			toast.success('Photo added');
		} catch (err) {
			toast.error(errMsg(err, 'Could not upload photo'));
		}
		input.value = '';
		uploading = false;
	}
	async function removePhoto(photoId: string) {
		try {
			await deleteJobPhoto(photoId).updates(getJobPhotos);
		} catch (err) {
			toast.error(errMsg(err, 'Could not delete'));
		}
	}

	const stock = $derived(await getInventory());
	let addingMat = $state(false);
	let matItem = $state('');
	let matQty = $state(1);
	let matPrice = $state<number | null>(null);
	function pickMat(v: string) {
		matItem = v;
		matPrice = stock.find((s) => s.item.id === v)?.item.unitCost ?? 0;
	}
	async function logMaterial(e: SubmitEvent) {
		e.preventDefault();
		if (!matItem) return;
		try {
			await addJobMaterial({
				jobId: id,
				inventoryItemId: matItem,
				qty: matQty,
				unitPrice: matPrice ?? 0
			}).updates(getJobMaterials);
			addingMat = false;
			matItem = '';
			matQty = 1;
			matPrice = null;
			toast.success('Material logged');
		} catch (err) {
			toast.error(errMsg(err, 'Could not log material'));
		}
	}
	async function removeMat(materialId: string) {
		try {
			await removeJobMaterial(materialId).updates(getJobMaterials);
		} catch (err) {
			toast.error(errMsg(err, 'Could not remove material'));
		}
	}

	let rebooking = $state(false);
	async function rebook() {
		rebooking = true;
		try {
			const n = await createJob({
				customerId: j.job.customerId,
				jobTypeId: j.job.jobTypeId ?? null,
				serviceLocationId: j.job.serviceLocationId ?? null,
				equipmentId: j.job.equipmentId ?? null,
				summary: j.job.summary,
				description: j.job.description,
				priority: j.job.priority,
				startsAt: null
			}).updates(getJobs);
			toast.success(`Job J-${n!.number} booked`);
			await goto(`/jobs/${n!.id}`);
		} catch (err) {
			toast.error(errMsg(err, 'Could not rebook'));
		}
		rebooking = false;
	}

	let note = $state('');
	async function addNote(e: SubmitEvent) {
		e.preventDefault();
		if (!note.trim()) return;
		try {
			await recordJobEvent({ jobId: id, kind: 'note', note }).updates(getJob);
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
		{#if j.job.status === 'done'}
			<Button size="sm" variant="outline" disabled={rebooking} onclick={rebook}
				><Repeat /> Book again</Button
			>
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
						<Field.Label>Equipment</Field.Label>
						<Select.Root type="single" bind:value={equipmentId}>
							<Select.Trigger class="w-full"
								>{c.equipment.find((e) => e.equipment.id === equipmentId)?.equipment.name ??
									'None'}</Select.Trigger
							>
							<Select.Content>
								{#each c.equipment.filter((e) => e.equipment.active || e.equipment.id === equipmentId) as e (e.equipment.id)}
									<Select.Item value={e.equipment.id}>
										{e.equipment.name}{[e.equipment.brand, e.equipment.model].filter(Boolean).length
											? ` (${[e.equipment.brand, e.equipment.model].filter(Boolean).join(' ')})`
											: ''}
									</Select.Item>
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
			<Card.Header class="flex-row items-center justify-between space-y-0">
				<Card.Title class="flex items-center gap-2 text-base"
					><Timer class="size-4" /> Time</Card.Title
				>
				<span class="text-sm text-muted-foreground tabular-nums">{fmtDur(totalMin)}</span>
			</Card.Header>
			<Card.Content class="space-y-3 px-4">
				{#if !locked && time.myMemberId}
					<Button
						size="sm"
						variant={time.mine ? 'destructive' : 'outline'}
						class="w-full"
						onclick={toggleTimer}
					>
						{#if time.mine}<Square /> Clock out{:else}<Play /> Clock in{/if}
					</Button>
				{/if}
				<ul class="space-y-2">
					{#each time.entries as e (e.entry.id)}
						<li class="flex items-start gap-2 text-sm">
							<div class="min-w-0 flex-1">
								<p>
									{e.memberName ?? 'Former member'}
									<span class="text-muted-foreground tabular-nums">
										· {e.entry.endedAt ? fmtDur(minutes(e.entry)) : 'Running'}
									</span>
								</p>
								<p class="text-xs text-muted-foreground">
									{localDate(e.entry.startedAt, tz)}
									{localTime(e.entry.startedAt, tz)}
									{#if e.entry.endedAt}– {localTime(e.entry.endedAt, tz)}{/if}
									{#if e.entry.note}
										· {e.entry.note}{/if}
								</p>
							</div>
							{#if time.isAdmin || e.entry.memberId === time.myMemberId}
								<Button
									variant="ghost"
									size="icon"
									class="size-7 shrink-0 text-muted-foreground"
									onclick={() => removeTime(e.entry.id)}
								>
									<Trash2 class="size-3.5" />
								</Button>
							{/if}
						</li>
					{:else}
						<li class="text-sm text-muted-foreground">No time logged yet.</li>
					{/each}
				</ul>
				{#if !locked}
					{#if addingTime}
						<form class="grid gap-2 border-t pt-3" onsubmit={logTime}>
							{#if time.isAdmin}
								<Select.Root type="single" bind:value={teMember}>
									<Select.Trigger class="w-full"
										>{technicians.find((t) => t.id === teMember)?.name ?? 'Me'}</Select.Trigger
									>
									<Select.Content>
										{#each technicians as t (t.id)}
											<Select.Item value={t.id}>{t.name}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							{/if}
							<Input type="datetime-local" bind:value={teStart} required aria-label="Start" />
							<Input
								type="datetime-local"
								bind:value={teEnd}
								aria-label="End (blank = still running)"
							/>
							<Input placeholder="Note (optional)" bind:value={teNote} />
							<div class="flex gap-2">
								<Button type="submit" size="sm" disabled={!teStart}>Save</Button>
								<Button type="button" size="sm" variant="ghost" onclick={() => (addingTime = false)}
									>Cancel</Button
								>
							</div>
						</form>
					{:else}
						<Button size="sm" variant="ghost" class="w-full" onclick={() => (addingTime = true)}>
							<Plus /> Log time
						</Button>
					{/if}
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header class="flex-row items-center justify-between space-y-0">
				<Card.Title class="flex items-center gap-2 text-base"
					><Package class="size-4" /> Materials</Card.Title
				>
				{#if materials.length}
					<span class="text-sm text-muted-foreground tabular-nums">
						{formatMoney(
							materials.reduce((s, m) => s + m.material.qty * m.material.unitPrice, 0),
							settings.currency
						)}
					</span>
				{/if}
			</Card.Header>
			<Card.Content class="space-y-3 px-4">
				<ul class="space-y-2">
					{#each materials as m (m.material.id)}
						<li class="flex items-start gap-2 text-sm">
							<div class="min-w-0 flex-1">
								<p>
									{m.material.qty} × {m.itemName}
									{#if m.material.unitPrice}
										<span class="text-muted-foreground tabular-nums">
											· {formatMoney(m.material.qty * m.material.unitPrice, settings.currency)}
										</span>
									{/if}
								</p>
								<p class="text-xs text-muted-foreground">
									{#if m.memberName}{m.memberName} ·
									{/if}{localDate(m.material.createdAt, tz)}
								</p>
							</div>
							{#if !locked}
								<Button
									variant="ghost"
									size="icon"
									class="size-7 shrink-0 text-muted-foreground"
									onclick={() => removeMat(m.material.id)}
								>
									<Trash2 class="size-3.5" />
								</Button>
							{/if}
						</li>
					{:else}
						<li class="text-sm text-muted-foreground">No materials used yet.</li>
					{/each}
				</ul>
				{#if !locked}
					{#if addingMat}
						<form class="grid gap-2 border-t pt-3" onsubmit={logMaterial}>
							<Select.Root type="single" value={matItem} onValueChange={pickMat}>
								<Select.Trigger class="w-full"
									>{stock.find((s) => s.item.id === matItem)?.item.name ??
										'Pick an item…'}</Select.Trigger
								>
								<Select.Content>
									{#each stock as s (s.item.id)}
										<Select.Item value={s.item.id}
											>{s.item.name}
											<span class="text-muted-foreground">({s.item.qtyOnHand} {s.item.unit})</span
											></Select.Item
										>
									{/each}
								</Select.Content>
							</Select.Root>
							<div class="grid grid-cols-2 gap-2">
								<Input
									type="number"
									min={1}
									placeholder="Qty"
									aria-label="Quantity"
									bind:value={matQty}
								/>
								<MoneyInput bind:value={matPrice} placeholder="Unit price" />
							</div>
							<div class="flex gap-2">
								<Button type="submit" size="sm" disabled={!matItem || matQty < 1}>Log</Button>
								<Button type="button" size="sm" variant="ghost" onclick={() => (addingMat = false)}
									>Cancel</Button
								>
							</div>
						</form>
					{:else}
						<Button
							size="sm"
							variant="ghost"
							class="w-full"
							disabled={!stock.length}
							onclick={() => (addingMat = true)}
						>
							<Plus />
							{stock.length ? 'Log material' : 'Add stock items in Inventory first'}
						</Button>
					{/if}
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header class="flex-row items-center justify-between space-y-0">
				<Card.Title class="flex items-center gap-2 text-base"
					><Camera class="size-4" /> Photos</Card.Title
				>
				{#if photos.length}
					<span class="text-sm text-muted-foreground tabular-nums">{photos.length}</span>
				{/if}
			</Card.Header>
			<Card.Content class="px-4">
				{#if photos.length}
					<ul class="grid grid-cols-3 gap-2">
						{#each photos as p (p.id)}
							<li class="group relative">
								<a href="/files/job-photo/{p.id}" target="_blank" rel="noreferrer">
									<img
										src="/files/job-photo/{p.id}"
										alt={p.fileName}
										class="aspect-square w-full rounded-md border object-cover"
										loading="lazy"
									/>
								</a>
								{#if !locked}
									<Button
										variant="destructive"
										size="icon"
										class="absolute top-1 right-1 size-6 opacity-0 transition-opacity group-hover:opacity-100"
										onclick={() => removePhoto(p.id)}
										aria-label="Delete photo"
									>
										<Trash2 class="size-3" />
									</Button>
								{/if}
							</li>
						{/each}
					</ul>
				{:else}
					<p class="text-sm text-muted-foreground">No photos yet.</p>
				{/if}
				{#if !locked}
					<label
						class="mt-3 flex items-center justify-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground transition-colors hover:bg-accent {uploading
							? 'pointer-events-none opacity-60'
							: 'cursor-pointer'}"
					>
						<Camera class="size-4" />
						{uploading ? 'Uploading…' : 'Add a photo'}
						<input
							type="file"
							accept="image/*"
							class="sr-only"
							disabled={uploading}
							onchange={uploadPhoto}
						/>
					</label>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header class="flex-row items-center justify-between space-y-0">
				<Card.Title class="flex items-center gap-2 text-base"
					><ListChecks class="size-4" /> Checklist</Card.Title
				>
				{#if checklist.length}
					<span class="text-sm text-muted-foreground tabular-nums"
						>{checkDone}/{checklist.length} done</span
					>
				{/if}
			</Card.Header>
			<Card.Content class="space-y-2 px-4">
				<ul class="space-y-1.5">
					{#each checklist as item (item.id)}
						<li class="flex items-center gap-2 text-sm">
							<Checkbox
								checked={item.done}
								disabled={locked}
								onCheckedChange={() => toggleCheck(item)}
							/>
							<span class="min-w-0 flex-1 {item.done ? 'text-muted-foreground line-through' : ''}"
								>{item.label}</span
							>
							{#if !locked}
								<Button
									variant="ghost"
									size="icon"
									class="size-7 shrink-0 text-muted-foreground"
									onclick={() => delCheck(item.id)}
								>
									<Trash2 class="size-3.5" />
								</Button>
							{/if}
						</li>
					{:else}
						<li class="text-sm text-muted-foreground">
							No checklist items — add one, or set a template on the job type.
						</li>
					{/each}
				</ul>
				{#if !locked}
					<form class="flex gap-2 border-t pt-3" onsubmit={addCheck}>
						<Input placeholder="Add a step…" bind:value={newCheck} />
						<Button type="submit" size="sm" variant="outline" disabled={!newCheck.trim()}
							>Add</Button
						>
					</form>
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
