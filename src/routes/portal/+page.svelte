<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import { toast } from 'svelte-sonner';
	import {
		getPortalOverview,
		requestService,
		confirmVisit,
		requestReschedule,
		getProviders,
		startCheckout,
		updatePortalContact
	} from '#lib/remote/portal.remote.ts';
	import { errMsg, formatDate, formatMoney } from '#lib/format.ts';
	import { localDate, localTime } from '#lib/tz.ts';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import Wrench from '@lucide/svelte/icons/wrench';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const customerId = $derived(data.customerId);
	const d = $derived(await getPortalOverview(customerId));
	const providers = $derived(await getProviders(customerId));
	const todayIso = new Date().toISOString().slice(0, 10);
	const tz = $derived(d.settings?.timezone ?? 'UTC');
	const currency = $derived(d.settings?.currency ?? 'usd');

	let paying = $state(false);
	onMount(() => {
		if (page.url.searchParams.get('paid') === '1') {
			toast.success('Thanks! Your payment was received.');
			void goto('/portal', { shallow: true, replace: true });
		}
	});
	async function pay(provider: string) {
		paying = true;
		try {
			const { url } = await startCheckout({ customerId, provider });
			location.assign(url);
		} catch (err) {
			paying = false;
			toast.error(errMsg(err, 'Could not start payment'));
		}
	}

	// ------- reschedule request -------
	let reschedJobId = $state('');
	let reschedWhen = $state('');
	let reschedPending = $state(false);
	async function submitReschedule(e: SubmitEvent) {
		e.preventDefault();
		reschedPending = true;
		try {
			await requestReschedule({
				customerId,
				jobId: reschedJobId,
				preferredTime: reschedWhen.trim()
			}).updates(getPortalOverview);
			toast.success('Request sent — we will confirm a new time');
			reschedJobId = '';
			reschedWhen = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not send request'));
		}
		reschedPending = false;
	}

	let confirmingId = $state('');
	async function confirm(jobId: string) {
		confirmingId = jobId;
		try {
			await confirmVisit({ customerId, jobId }).updates(getPortalOverview);
			toast.success('Visit confirmed — see you then');
		} catch (err) {
			toast.error(errMsg(err, 'Could not confirm'));
		}
		confirmingId = '';
	}

	// ------- your details -------
	let contactEmail = $state('');
	let contactPhone = $state('');
	let contactText = $state(true);
	let contactEmailUpdates = $state(true);
	let contactPending = $state(false);
	let contactLoaded = '';
	$effect(() => {
		if (d.customer.id !== contactLoaded) {
			contactLoaded = d.customer.id;
			contactEmail = d.customer.email ?? '';
			contactPhone = d.customer.phone ?? '';
			contactText = !d.customer.smsOptOut;
			contactEmailUpdates = !d.customer.emailOptOut;
		}
	});
	async function saveContact(e: SubmitEvent) {
		e.preventDefault();
		contactPending = true;
		try {
			await updatePortalContact({
				customerId,
				email: contactEmail.trim(),
				phone: contactPhone.trim(),
				smsOptOut: !contactText,
				emailOptOut: !contactEmailUpdates
			}).updates(getPortalOverview);
			toast.success('Details saved');
		} catch (err) {
			toast.error(errMsg(err, 'Could not save'));
		}
		contactPending = false;
	}

	// ------- request service -------
	let reqOpen = $state(false);
	let reqPending = $state(false);
	let reqLocationId = $state('');
	let reqDescription = $state('');
	let reqPreferred = $state('');
	let reqMemberId = $state('any');

	async function submitRequest(e: SubmitEvent) {
		e.preventDefault();
		reqPending = true;
		try {
			await requestService({
				customerId,
				serviceLocationId: reqLocationId || null,
				jobTypeId: null,
				description: reqDescription,
				preferredTime: reqPreferred,
				preferredMemberId: reqMemberId !== 'any' ? reqMemberId : undefined
			});
			toast.success('Request sent — we will confirm a time');
			reqOpen = false;
			reqDescription = reqPreferred = '';
			reqMemberId = 'any';
		} catch (err) {
			toast.error(errMsg(err, 'Could not send request'));
		}
		reqPending = false;
	}
</script>

<div class="flex items-center justify-between gap-3">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">Hi, {d.customer.name}</h1>
		<p class="text-sm text-muted-foreground">
			{#if data.options.length > 1}
				<Select.Root
					type="single"
					value={customerId}
					onValueChange={(v: string) => goto(`/portal?c=${v}`)}
				>
					<Select.Trigger class="h-8 w-48">
						{data.options.find((o) => o.customerId === customerId)?.companyName}
					</Select.Trigger>
					<Select.Content>
						{#each data.options as o (o.customerId)}
							<Select.Item value={o.customerId}>{o.companyName}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			{:else}
				{data.options[0]?.companyName}
			{/if}
		</p>
	</div>
	<Button onclick={() => (reqOpen = true)}><Wrench /> Request service</Button>
</div>

<div class="grid gap-6 md:grid-cols-2">
	<!-- upcoming jobs -->
	<Card.Root>
		<Card.Header><Card.Title class="text-base">Scheduled visits</Card.Title></Card.Header>
		<Card.Content class="px-0">
			<Table.Root>
				<Table.Body>
					{#each d.upcoming as j (j.job.id)}
						<Table.Row>
							<Table.Cell class="pl-6">
								<p class="font-medium">{j.job.summary || j.jobTypeName || 'Service visit'}</p>
								<p class="text-xs text-muted-foreground">
									{#if j.address1}{j.address1}, {j.city} ·
									{/if}
									{j.technicianName ? `Tech: ${j.technicianName}` : 'Tech TBD'}
								</p>
							</Table.Cell>
							<Table.Cell class="text-muted-foreground">
								{j.job.startsAt
									? `${localDate(j.job.startsAt, tz)} ${localTime(j.job.startsAt, tz)}`
									: 'Scheduling'}
							</Table.Cell>
							<Table.Cell class="pr-6 text-right">
								{#if j.confirmed}
									<StatusBadge status="approved" label="Confirmed" />
								{:else if j.job.status === 'scheduled' && j.job.startsAt}
									<div class="flex flex-col items-end gap-1 sm:flex-row sm:items-center">
										<Button
											size="sm"
											variant="outline"
											disabled={confirmingId === j.job.id}
											onclick={() => confirm(j.job.id)}
											>{confirmingId === j.job.id ? 'Confirming…' : 'Confirm'}</Button
										>
										<Button size="sm" variant="ghost" onclick={() => (reschedJobId = j.job.id)}
											>Different time</Button
										>
									</div>
								{:else}
									<StatusBadge status={j.job.status} />
								{/if}
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell class="pl-6 text-muted-foreground">Nothing scheduled.</Table.Cell
							></Table.Row
						>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>

	<!-- visit history -->
	<Card.Root>
		<Card.Header><Card.Title class="text-base">Past visits</Card.Title></Card.Header>
		<Card.Content class="px-0">
			<Table.Root>
				<Table.Body>
					{#each d.history as j (j.job.id)}
						<Table.Row>
							<Table.Cell class="pl-6">
								<p class="font-medium">{j.job.summary || j.jobTypeName || 'Service visit'}</p>
								<p class="text-xs text-muted-foreground">
									{j.job.completedAt ? formatDate(j.job.completedAt) : ''}
								</p>
								{#if j.photos?.length}
									<div class="mt-2 flex flex-wrap gap-2">
										{#each j.photos as pid (pid)}
											<a href="/files/portal-job-photo/{pid}" target="_blank" rel="noreferrer">
												<img
													src="/files/portal-job-photo/{pid}"
													alt="Photo from your visit"
													class="size-16 rounded-md border object-cover"
												/>
											</a>
										{/each}
									</div>
								{/if}
							</Table.Cell>
							<Table.Cell class="pr-6 text-right text-sm text-muted-foreground">
								{j.invoiceNumber ? `Invoice INV-${j.invoiceNumber}` : ''}
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell class="pl-6 text-muted-foreground">No visits yet.</Table.Cell></Table.Row
						>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>

	<div class="space-y-6">
		<!-- balance / pay -->
		<Card.Root>
			<Card.Header class="flex-row items-center justify-between">
				<Card.Title class="text-base">Balance</Card.Title>
				<span class="text-xl font-semibold tabular-nums">{formatMoney(d.balance, currency)}</span>
			</Card.Header>
			<Card.Content class="px-6">
				{#if d.openCharges.length}
					<ul class="space-y-2 text-sm">
						{#each d.openCharges as row (row.charge.id)}
							<li class="flex items-center justify-between">
								<span class="truncate">
									{row.charge.description || 'Charge'}
									{#if row.invoiceNumber}<span class="text-xs text-muted-foreground"
											>· INV-{row.invoiceNumber}</span
										>{/if}
								</span>
								<span class="tabular-nums"
									>{formatMoney(row.charge.amount - row.paid, currency)}</span
								>
							</li>
						{/each}
					</ul>
					{#if providers.length}
						<div class="mt-4 flex gap-2">
							{#each providers as p (p.id)}
								<Button variant="secondary" disabled={paying} onclick={() => pay(p.id)}>
									<CreditCard /> Pay with {p.name}
								</Button>
							{/each}
						</div>
					{/if}
				{:else}
					<p class="text-sm text-muted-foreground">You're all paid up.</p>
				{/if}
			</Card.Content>
		</Card.Root>

		<!-- agreements -->
		<Card.Root>
			<Card.Header><Card.Title class="text-base">Service agreement</Card.Title></Card.Header>
			<Card.Content class="px-6">
				{#each d.agreements as a (a.agreement.id)}
					<div class="flex items-center justify-between text-sm">
						<span class="font-medium">{a.plan.name}</span>
						<StatusBadge status={a.agreement.status} />
					</div>
					<p class="mt-1 text-xs text-muted-foreground">
						{formatMoney(a.plan.amount, currency)}/{a.plan.interval} ·
						{#if a.agreement.status === 'active'}renews {formatDate(
								a.agreement.nextChargeAt
							)}{:else}ended{/if}
					</p>
				{:else}
					<p class="text-sm text-muted-foreground">
						No agreement — ask about a maintenance plan next visit.
					</p>
				{/each}
			</Card.Content>
		</Card.Root>

		<!-- your equipment -->
		{#if d.units.length}
			<Card.Root>
				<Card.Header><Card.Title class="text-base">Your equipment</Card.Title></Card.Header>
				<Card.Content class="px-0">
					<Table.Root>
						<Table.Body>
							{#each d.units as u (u.equipment.id)}
								<Table.Row>
									<Table.Cell class="pl-6">
										<p class="font-medium">
											{u.equipment.name}
											{#if !u.equipment.active}
												<span class="text-xs text-muted-foreground">(retired)</span>
											{/if}
										</p>
										<p class="text-xs text-muted-foreground">
											{[u.equipment.brand, u.equipment.model].filter(Boolean).join(' ') ||
												u.equipment.category}
											{#if u.locationLabel}
												· {u.locationLabel}{/if}
										</p>
									</Table.Cell>
									<Table.Cell class="pr-6 text-right">
										{#if u.equipment.warrantyUntil}
											{#if u.equipment.warrantyUntil < todayIso}
												<span class="text-xs text-destructive"
													>Warranty ended {formatDate(u.equipment.warrantyUntil)}</span
												>
											{:else}
												<span class="text-xs text-muted-foreground"
													>Warranty until {formatDate(u.equipment.warrantyUntil)}</span
												>
											{/if}
										{:else}
											<span class="text-xs text-muted-foreground">—</span>
										{/if}
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</Card.Content>
			</Card.Root>
		{/if}

		<!-- pending estimates -->
		{#if d.pendingEstimates.length}
			<Card.Root>
				<Card.Header
					><Card.Title class="text-base">Estimates waiting on you</Card.Title></Card.Header
				>
				<Card.Content class="px-0">
					<Table.Root>
						<Table.Body>
							{#each d.pendingEstimates as e (e.estimate.id)}
								<Table.Row>
									<Table.Cell class="pl-6 font-medium">E-{e.estimate.number}</Table.Cell>
									<Table.Cell class="tabular-nums">{formatMoney(e.total, currency)}</Table.Cell>
									<Table.Cell class="pr-6 text-right">
										<Button size="sm" variant="outline" href="/e/{e.token}">Review</Button>
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</Card.Content>
			</Card.Root>
		{/if}

		<!-- contact info -->
		<Card.Root>
			<Card.Header><Card.Title class="text-base">Your details</Card.Title></Card.Header>
			<Card.Content>
				<form class="space-y-3" onsubmit={saveContact}>
					<Field.Field>
						<Field.Label for="p-email">Email</Field.Label>
						<Input id="p-email" type="email" bind:value={contactEmail} />
					</Field.Field>
					<Field.Field>
						<Field.Label for="p-phone">Phone</Field.Label>
						<Input id="p-phone" bind:value={contactPhone} />
					</Field.Field>
					<div class="flex items-center justify-between gap-3 text-sm">
						<label for="p-texts">Text me updates</label>
						<Switch id="p-texts" bind:checked={contactText} />
					</div>
					<div class="flex items-center justify-between gap-3 text-sm">
						<label for="p-emails">Email me updates</label>
						<Switch id="p-emails" bind:checked={contactEmailUpdates} />
					</div>
					<Button type="submit" size="sm" disabled={contactPending}
						>{contactPending ? 'Saving…' : 'Save details'}</Button
					>
				</form>
				<p class="mt-3 text-xs text-muted-foreground">
					Used for appointment reminders, invoices, and estimate links.
				</p>
			</Card.Content>
		</Card.Root>
	</div>
</div>

<!-- request service dialog -->
<Dialog.Root bind:open={reqOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Request service</Dialog.Title>
			<Dialog.Description>Tell us what you need and when works for you.</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={submitRequest}>
			<Field.Field>
				<Field.Label>Location</Field.Label>
				<Select.Root type="single" bind:value={reqLocationId}>
					<Select.Trigger class="w-full"
						>{d.locations.find((l) => l.id === reqLocationId)
							? `${d.locations.find((l) => l.id === reqLocationId)!.label || d.locations.find((l) => l.id === reqLocationId)!.address1} ${d.locations.find((l) => l.id === reqLocationId)!.city}`
							: 'Pick an address'}</Select.Trigger
					>
					<Select.Content>
						{#each d.locations as l (l.id)}
							<Select.Item value={l.id}
								>{l.label ? `${l.label} — ` : ''}{l.address1}, {l.city}</Select.Item
							>
						{/each}
					</Select.Content>
				</Select.Root>
			</Field.Field>
			{#if d.techs.length > 1}
				<Field.Field>
					<Field.Label
						>Preferred technician <span class="text-muted-foreground">(optional)</span></Field.Label
					>
					<Select.Root type="single" bind:value={reqMemberId}>
						<Select.Trigger class="w-full"
							>{reqMemberId === 'any'
								? 'No preference'
								: (d.techs.find((t) => t.id === reqMemberId)?.name ??
									'No preference')}</Select.Trigger
						>
						<Select.Content>
							<Select.Item value="any">No preference</Select.Item>
							{#each d.techs as t (t.id)}
								<Select.Item value={t.id}>{t.name}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</Field.Field>
			{/if}
			<Field.Field>
				<Field.Label for="r-when">Preferred time</Field.Label>
				<Input id="r-when" bind:value={reqPreferred} placeholder="e.g. tomorrow morning" />
			</Field.Field>
			<Field.Field>
				<Field.Label for="r-desc">What's going on?</Field.Label>
				<Textarea id="r-desc" rows={3} bind:value={reqDescription} />
			</Field.Field>
			<Dialog.Footer>
				<Button type="submit" disabled={reqPending}
					>{reqPending ? 'Sending…' : 'Send request'}</Button
				>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<!-- reschedule request dialog -->
<Dialog.Root
	open={!!reschedJobId}
	onOpenChange={(o: boolean) => {
		if (!o) reschedJobId = '';
	}}
>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Request a different time</Dialog.Title>
			<Dialog.Description>
				Tell us when works better and we'll confirm a new slot.
			</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={submitReschedule}>
			<Field.Field>
				<Field.Label for="resched-when">Preferred time</Field.Label>
				<Input
					id="resched-when"
					bind:value={reschedWhen}
					placeholder="e.g. Friday afternoon, or after 3pm weekdays"
				/>
			</Field.Field>
			<Dialog.Footer>
				<Button type="submit" disabled={reschedPending || !reschedWhen.trim()}
					>{reschedPending ? 'Sending…' : 'Send request'}</Button
				>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
