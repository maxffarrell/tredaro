<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { toast } from 'svelte-sonner';
	import {
		getPortalOverview,
		requestService,
		confirmVisit,
		requestReschedule,
		getProviders,
		saveCardOnFile,
		startCheckout,
		updatePortalContact,
		rateVisit
	} from '#lib/remote/portal.remote.ts';
	import { errMsg, formatDate, formatMoney } from '#lib/format.ts';
	import { localDate, localTime } from '#lib/tz.ts';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import Wrench from '@lucide/svelte/icons/wrench';
	import Star from '@lucide/svelte/icons/star';
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
		if (page.url.searchParams.get('card') === '1') {
			toast.success('Your card is saved — recurring charges will be collected automatically.');
			void goto('/portal', { shallow: true, replace: true });
		}
	});
	async function pay(provider: string) {
		paying = true;
		try {
			const { url } = await startCheckout({
				customerId,
				provider,
				charges: [...(selectedCharges ?? d.openCharges.map((c) => c.charge.id))]
			});
			location.assign(url);
		} catch (err) {
			paying = false;
			toast.error(errMsg(err, 'Could not start payment'));
		}
	}

	// Per-charge selection: a subset pays only those charges (recorded against them
	// via the checkout metadata), not the whole balance. null = all selected.
	let selectedCharges = $state<SvelteSet<string> | null>(null);
	const selectedTotal = $derived(
		d.openCharges
			.filter((c) => !selectedCharges || selectedCharges.has(c.charge.id))
			.reduce((sum, c) => sum + (c.charge.amount - c.paid), 0)
	);
	function chargeChecked(id: string) {
		return !selectedCharges || selectedCharges.has(id);
	}
	function toggleCharge(id: string, on: boolean) {
		const next = new SvelteSet(selectedCharges ?? d.openCharges.map((c) => c.charge.id));
		if (on) next.add(id);
		else next.delete(id);
		selectedCharges = next;
	}
	let savingCard = $state(false);
	async function saveCard(provider: string) {
		savingCard = true;
		try {
			const { url } = await saveCardOnFile({ customerId, provider });
			location.assign(url);
		} catch (err) {
			savingCard = false;
			toast.error(errMsg(err, 'Could not open card setup'));
		}
	}

	// ------- visit rating -------
	let rateOpen = $state(false);
	let rateJobId = $state('');
	let rateValue = $state(0);
	let rateNote = $state('');
	let ratePending = $state(false);
	function openRate(jobId: string) {
		rateJobId = jobId;
		rateValue = 0;
		rateNote = '';
		rateOpen = true;
	}
	async function submitRating() {
		if (!rateValue) return;
		ratePending = true;
		try {
			await rateVisit({ customerId, jobId: rateJobId, rating: rateValue, note: rateNote });
			toast.success('Thanks for the feedback!');
			rateOpen = false;
		} catch (err) {
			toast.error(errMsg(err, 'Could not save rating'));
		}
		ratePending = false;
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
	let reqEquipmentId = $state<string | null>(null);
	let reqType = $state<'visit' | 'quote'>('visit');

	function requestFor(u: {
		equipment: { id: string; name: string; brand: string | null; model: string | null };
	}) {
		reqEquipmentId = u.equipment.id;
		reqDescription = `Service for ${u.equipment.name}${[u.equipment.brand, u.equipment.model].filter(Boolean).length ? ` (${[u.equipment.brand, u.equipment.model].filter(Boolean).join(' ')})` : ''}`;
		reqType = 'visit';
		reqOpen = true;
	}

	async function submitRequest(e: SubmitEvent) {
		e.preventDefault();
		reqPending = true;
		try {
			await requestService({
				customerId,
				requestType: reqType,
				equipmentId: reqEquipmentId,
				serviceLocationId: reqLocationId || null,
				jobTypeId: null,
				description: reqDescription,
				preferredTime: reqPreferred,
				preferredMemberId: reqMemberId !== 'any' ? reqMemberId : undefined
			});
			toast.success(
				reqType === 'quote'
					? 'Quote request sent — we will follow up'
					: 'Request sent — we will confirm a time'
			);
			reqOpen = false;
			reqDescription = reqPreferred = '';
			reqMemberId = 'any';
			reqEquipmentId = null;
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
	<Button
		onclick={() => {
			reqType = 'visit';
			reqOpen = true;
		}}><Wrench /> Request service</Button
	>
</div>

<div class="grid grid-cols-1 gap-6 md:grid-cols-2">
	<!-- upcoming jobs -->
	<Card.Root>
		<Card.Header><Card.Title class="text-base">Scheduled visits</Card.Title></Card.Header>
		<Card.Content class="overflow-x-auto px-0">
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
		<Card.Content class="overflow-x-auto px-0">
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
								{#if j.job.rating}
									<span class="inline-flex items-center gap-0.5" title={j.job.ratingNote ?? ''}>
										{#each [1, 2, 3, 4, 5] as n (n)}
											<Star
												class="size-3.5 {n <= j.job.rating!
													? 'fill-amber-400 text-amber-400'
													: 'text-muted-foreground/40'}"
											/>
										{/each}
									</span>
								{:else}
									<Button size="sm" variant="outline" onclick={() => openRate(j.job.id)}
										>Rate visit</Button
									>
								{/if}
								<p>{j.invoiceNumber ? `Invoice INV-${j.invoiceNumber}` : ''}</p>
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
							<li class="flex items-center justify-between gap-2">
								<label class="flex min-w-0 items-center gap-2">
									{#if d.openCharges.length > 1}
										<Checkbox
											checked={chargeChecked(row.charge.id)}
											onCheckedChange={(v) => toggleCharge(row.charge.id, v === true)}
											aria-label="Include this charge in the payment"
										/>
									{/if}
									<span class="truncate">
										{row.charge.description || 'Charge'}
										{#if row.invoiceNumber}<span class="text-xs text-muted-foreground"
												>· INV-{row.invoiceNumber}</span
											>{/if}
									</span>
								</label>
								<span class="shrink-0 tabular-nums"
									>{formatMoney(row.charge.amount - row.paid, currency)}</span
								>
							</li>
						{/each}
					</ul>
					{#if providers.length}
						<div class="mt-4 flex gap-2">
							{#each providers as p (p.id)}
								<Button
									variant="secondary"
									disabled={paying || !selectedTotal}
									onclick={() => pay(p.id)}
								>
									<CreditCard />
									Pay {formatMoney(selectedTotal, currency)} with {p.name}
								</Button>
							{/each}
						</div>
					{/if}
				{:else}
					<p class="text-sm text-muted-foreground">You're all paid up.</p>
				{/if}
				<div class="mt-4 border-t pt-3">
					{#if d.customer.savedCardLabel}
						<p class="flex items-center gap-2 text-sm text-muted-foreground">
							<CreditCard class="size-4" />
							{d.customer.savedCardLabel} on file — recurring charges are collected automatically.
						</p>
					{:else if providers.some((p) => p.canSaveCard)}
						{#each providers as p (p.id)}
							{#if p.canSaveCard}
								<Button
									variant="ghost"
									size="sm"
									class="px-0 text-muted-foreground"
									disabled={savingCard}
									onclick={() => saveCard(p.id)}
								>
									<CreditCard /> Save a card for automatic payments
								</Button>
							{/if}
						{/each}
					{/if}
				</div>
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
				<Card.Content class="overflow-x-auto px-0">
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
										{#if u.equipment.active && u.equipment.nextServiceDue}
											{#if u.equipment.nextServiceDue <= todayIso}
												<p class="mt-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
													Due for service — request a visit below
												</p>
											{:else}
												<p class="mt-0.5 text-xs text-muted-foreground">
													Next service {formatDate(u.equipment.nextServiceDue)}
												</p>
											{/if}
										{/if}
									</Table.Cell>
									<Table.Cell class="pr-6 text-right">
										{#if u.equipment.active}
											<Button
												variant="ghost"
												size="sm"
												class="h-7 px-2 text-xs"
												onclick={() => requestFor(u)}>Request service</Button
											>
										{/if}
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
				<Card.Content class="overflow-x-auto px-0">
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

		{#if d.recentInvoices?.length}
			<Card.Root>
				<Card.Header><Card.Title class="text-base">Recent invoices</Card.Title></Card.Header>
				<Card.Content class="overflow-x-auto px-0">
					<Table.Root>
						<Table.Body>
							{#each d.recentInvoices as inv (inv.invoice.id)}
								<Table.Row>
									<Table.Cell class="pl-6 font-medium">INV-{inv.invoice.number}</Table.Cell>
									<Table.Cell class="text-muted-foreground"
										>{formatDate(inv.invoice.createdAt)}</Table.Cell
									>
									<Table.Cell
										><StatusBadge
											status={inv.invoice.status === 'open' &&
											inv.total > 0 &&
											inv.total - inv.paid <= 0
												? 'paid'
												: inv.invoice.status === 'open' && inv.paid > 0
													? 'partial'
													: inv.invoice.status}
										/></Table.Cell
									>
									<Table.Cell class="pr-6 text-right tabular-nums"
										>{formatMoney(inv.total, currency)}</Table.Cell
									>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</Card.Content>
			</Card.Root>
		{/if}

		{#if d.recentPayments?.length}
			<Card.Root>
				<Card.Header><Card.Title class="text-base">Recent payments</Card.Title></Card.Header>
				<Card.Content class="overflow-x-auto px-0">
					<Table.Root>
						<Table.Body>
							{#each d.recentPayments as p (p.payment.id)}
								<Table.Row>
									<Table.Cell class="pl-6 font-medium">
										{formatMoney(p.payment.amount, currency)}
										{#if p.payment.amount < 0}
											<Badge variant="secondary" class="ml-1"
												>{p.payment.reference?.startsWith('applied:')
													? 'credit applied'
													: 'refund'}</Badge
											>
										{/if}
									</Table.Cell>
									<Table.Cell class="text-muted-foreground capitalize"
										>{p.payment.method}</Table.Cell
									>
									<Table.Cell class="text-muted-foreground"
										>{p.invoiceNumber ? `INV-${p.invoiceNumber}` : '—'}</Table.Cell
									>
									<Table.Cell class="pr-6 text-right text-muted-foreground"
										>{formatDate(p.payment.paidAt)}</Table.Cell
									>
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

<!-- visit rating dialog -->
<Dialog.Root bind:open={rateOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>How was the visit?</Dialog.Title>
		</Dialog.Header>
		<div class="space-y-4">
			<div class="flex gap-1">
				{#each [1, 2, 3, 4, 5] as n (n)}
					<button
						type="button"
						aria-label="{n} star{n === 1 ? '' : 's'}"
						onclick={() => (rateValue = n)}
					>
						<Star
							class="size-8 {n <= rateValue
								? 'fill-amber-400 text-amber-400'
								: 'text-muted-foreground/40'}"
						/>
					</button>
				{/each}
			</div>
			<Textarea rows={3} bind:value={rateNote} placeholder="Anything we should know? (optional)" />
			<Button class="w-full" disabled={!rateValue || ratePending} onclick={submitRating}
				>{ratePending ? 'Saving…' : 'Submit rating'}</Button
			>
		</div>
	</Dialog.Content>
</Dialog.Root>

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
				<Field.Label>What do you need?</Field.Label>
				<Select.Root type="single" bind:value={reqType}>
					<Select.Trigger class="w-full"
						>{reqType === 'quote' ? 'A written quote first' : 'A service visit'}</Select.Trigger
					>
					<Select.Content>
						<Select.Item value="visit">A service visit</Select.Item>
						<Select.Item value="quote">A written quote first</Select.Item>
					</Select.Content>
				</Select.Root>
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
