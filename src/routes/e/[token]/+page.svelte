<script lang="ts">
	import { page } from '$app/state';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import Printer from '@lucide/svelte/icons/printer';
	import { toast } from 'svelte-sonner';
	import {
		decidePublicEstimate,
		requestEstimateChangesPublic,
		setVisitPreferencePublic
	} from '#lib/remote/public.remote.ts';
	import Logo from '#lib/components/app/logo.svelte';
	import { errMsg, formatDate, formatMoney } from '#lib/format.ts';
	import { SvelteSet } from 'svelte/reactivity';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const { estimate: est, orgName, customerName, items, currency, location: loc } = $derived(data);
	/** Optional lines the customer excludes — all are included by default. */
	let excluded = new SvelteSet<string>();
	const hasOptional = $derived(items.some((i) => i.optional));
	const total = $derived(
		items.reduce((s, i) => s + (excluded.has(i.id) ? 0 : i.qty * i.unitPrice), 0)
	);
	function toggleOptional(id: string, on: boolean) {
		if (on) excluded.delete(id);
		else excluded.add(id);
	}

	let decided = $state<'approved' | 'declined' | null>(
		est.status === 'approved' || est.status === 'converted'
			? 'approved'
			: est.status === 'declined'
				? 'declined'
				: null
	);
	let name = $state('');
	let note = $state('');
	let pending = $state(false);
	let changesSent = $state(false);
	let prefNote = $state('');
	let prefSent = $state(false);

	async function sendPreference() {
		if (!prefNote.trim()) {
			toast.error('Say when works best');
			return;
		}
		pending = true;
		try {
			await setVisitPreferencePublic({ token: page.params.token!, note: prefNote.trim() });
			prefSent = true;
		} catch (err) {
			toast.error(errMsg(err, 'Could not submit'));
		}
		pending = false;
	}

	async function requestChanges() {
		if (!note.trim()) {
			toast.error('Say what to change in the note');
			return;
		}
		pending = true;
		try {
			await requestEstimateChangesPublic({
				token: page.params.token!,
				name: name.trim() || undefined,
				note: note.trim()
			});
			changesSent = true;
		} catch (err) {
			toast.error(errMsg(err, 'Could not submit'));
		}
		pending = false;
	}

	async function decide(approve: boolean) {
		if (approve && !name.trim()) {
			toast.error('Type your name to approve');
			return;
		}
		pending = true;
		try {
			await decidePublicEstimate({
				token: page.params.token!,
				approve,
				name: name.trim(),
				note: note.trim(),
				items: approve
					? items.filter((i) => i.optional && !excluded.has(i.id)).map((i) => i.id)
					: []
			});
			decided = approve ? 'approved' : 'declined';
		} catch (err) {
			toast.error(errMsg(err, 'Could not submit'));
		}
		pending = false;
	}
</script>

<svelte:head>
	<title>Estimate E-{est.number} — {orgName}</title>
</svelte:head>

<div class="min-h-svh bg-muted/30">
	<header class="border-b bg-background print:hidden">
		<div class="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
			<Logo />
			<span class="truncate font-semibold">{orgName}</span>
		</div>
	</header>

	<main class="mx-auto max-w-3xl space-y-6 p-4 py-8">
		<div class="flex items-center justify-between gap-3">
			<div>
				<h1 class="text-2xl font-semibold tracking-tight">Estimate E-{est.number}</h1>
				<p class="text-sm text-muted-foreground">
					For {customerName}
					{#if loc?.address1}· {loc.address1}, {loc.city}{/if}
				</p>
				{#if est.validUntil && est.status === 'sent'}
					<p class="text-xs text-muted-foreground">Valid until {formatDate(est.validUntil)}</p>
				{/if}
			</div>
			<div class="flex items-center gap-2">
				<StatusBadge status={decided ?? est.status} />
				<Button size="sm" variant="outline" class="print:hidden" onclick={() => window.print()}
					><Printer /> Print</Button
				>
			</div>
		</div>

		<Card.Root>
			<Card.Content class="overflow-x-auto px-0">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head class="pl-6">Item</Table.Head>
							<Table.Head class="w-16 text-right">Qty</Table.Head>
							<Table.Head class="w-28 text-right">Unit</Table.Head>
							<Table.Head class="w-28 pr-6 text-right">Amount</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each items as i (i.id)}
							<Table.Row>
								<Table.Cell class="pl-6"
									>{#if i.optional && !decided && est.status === 'sent'}
										<label
											class="mr-2 inline-flex cursor-pointer items-center gap-1.5 align-middle text-xs text-muted-foreground"
										>
											<input
												type="checkbox"
												class="accent-primary"
												checked={!excluded.has(i.id)}
												onchange={(e) => toggleOptional(i.id, e.currentTarget.checked)}
											/>
											include
										</label>
									{:else if i.optional}<Badge variant="secondary" class="mr-1 font-normal"
											>{excluded.has(i.id) ? 'Skipped' : 'Optional'}</Badge
										>{/if}{i.name}<span class="text-muted-foreground">
										{i.description}</span
									></Table.Cell
								>
								<Table.Cell class="text-right">{i.qty}</Table.Cell>
								<Table.Cell class="text-right tabular-nums"
									>{formatMoney(i.unitPrice, currency)}</Table.Cell
								>
								<Table.Cell class="pr-6 text-right tabular-nums"
									>{formatMoney(i.qty * i.unitPrice, currency)}</Table.Cell
								>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
				<div class="flex justify-between border-t px-6 py-3 text-sm font-semibold tabular-nums">
					<span>Total{hasOptional ? ' (with selected options)' : ''}</span><span
						>{formatMoney(total, currency)}</span
					>
				</div>
			</Card.Content>
		</Card.Root>

		{#if est.notes}
			<Card.Root>
				<Card.Header><Card.Title class="text-base">Notes</Card.Title></Card.Header>
				<Card.Content class="px-6 text-sm whitespace-pre-wrap">{est.notes}</Card.Content>
			</Card.Root>
		{/if}

		{#if decided === 'approved'}
			<Card.Root class="border-emerald-500/50">
				<Card.Content class="py-6 text-center">
					<p class="font-semibold">Estimate approved</p>
					<p class="mt-1 text-sm text-muted-foreground">
						{orgName} will reach out to schedule the work.
					</p>
					{#if est.jobId}
						{#if prefSent}
							<p class="mt-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
								Got it — they'll schedule around your note.
							</p>
						{:else}
							<div class="mx-auto mt-4 max-w-sm text-left">
								<Field.Field>
									<Field.Label for="visit-pref">When works best for you?</Field.Label>
									<Textarea
										id="visit-pref"
										bind:value={prefNote}
										rows={2}
										placeholder="Weekday mornings, after Thursday, anytime…"
									/>
								</Field.Field>
								<Button size="sm" class="mt-2" disabled={pending} onclick={sendPreference}
									>Send</Button
								>
							</div>
						{/if}
					{/if}
				</Card.Content>
			</Card.Root>
		{:else if est.status === 'expired'}
			<Card.Root>
				<Card.Content class="py-6 text-center">
					<p class="font-semibold">This estimate has expired</p>
					<p class="mt-1 text-sm text-muted-foreground">
						Contact {orgName} for an updated quote.
					</p>
				</Card.Content>
			</Card.Root>
		{:else if changesSent}
			<Card.Root>
				<Card.Content class="py-6 text-center">
					<p class="font-semibold">Change request sent</p>
					<p class="mt-1 text-sm text-muted-foreground">
						{orgName} will follow up with an updated quote.
					</p>
				</Card.Content>
			</Card.Root>
		{:else if decided === 'declined'}
			<Card.Root>
				<Card.Content class="py-6 text-center">
					<p class="font-semibold">Estimate declined</p>
					<p class="mt-1 text-sm text-muted-foreground">Thanks for letting {orgName} know.</p>
				</Card.Content>
			</Card.Root>
		{:else}
			<Card.Root class="print:hidden">
				<Card.Header>
					<Card.Title class="text-base">Your decision</Card.Title>
					<Card.Description
						>Approve to put this work on the schedule, or let {orgName} know you're passing.</Card.Description
					>
				</Card.Header>
				<Card.Content class="space-y-4 px-6">
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<Field.Field>
							<Field.Label for="dec-name">Your name</Field.Label>
							<Input id="dec-name" bind:value={name} placeholder="Required to approve" />
						</Field.Field>
						<Field.Field>
							<Field.Label for="dec-note">Note (optional)</Field.Label>
							<Input id="dec-note" bind:value={note} placeholder="Anything to add?" />
						</Field.Field>
					</div>
					<div class="flex flex-wrap gap-2">
						<Button onclick={() => decide(true)} disabled={pending}>Approve estimate</Button>
						<Button variant="outline" onclick={() => decide(false)} disabled={pending}
							>Decline</Button
						>
						<Button variant="ghost" onclick={requestChanges} disabled={pending}
							>Request changes</Button
						>
					</div>
				</Card.Content>
			</Card.Root>
		{/if}
	</main>
</div>
