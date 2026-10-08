<script lang="ts">
	import { page } from '$app/state';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import Printer from '@lucide/svelte/icons/printer';
	import { toast } from 'svelte-sonner';
	import { decidePublicEstimate } from '#lib/remote/public.remote.ts';
	import Logo from '#lib/components/app/logo.svelte';
	import { errMsg, formatMoney } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const { estimate: est, orgName, customerName, items, currency, location: loc } = $derived(data);
	const total = $derived(items.reduce((s, i) => s + i.qty * i.unitPrice, 0));

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
				note: note.trim()
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
			</div>
			<div class="flex items-center gap-2">
				<StatusBadge status={decided ?? est.status} />
				<Button size="sm" variant="outline" class="print:hidden" onclick={() => window.print()}
					><Printer /> Print</Button
				>
			</div>
		</div>

		<Card.Root>
			<Card.Content class="px-0">
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
									>{i.name}<span class="text-muted-foreground"> {i.description}</span></Table.Cell
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
					<span>Total</span><span>{formatMoney(total, currency)}</span>
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
					<div class="grid gap-4 sm:grid-cols-2">
						<Field.Field>
							<Field.Label for="dec-name">Your name</Field.Label>
							<Input id="dec-name" bind:value={name} placeholder="Required to approve" />
						</Field.Field>
						<Field.Field>
							<Field.Label for="dec-note">Note (optional)</Field.Label>
							<Input id="dec-note" bind:value={note} placeholder="Anything to add?" />
						</Field.Field>
					</div>
					<div class="flex gap-2">
						<Button onclick={() => decide(true)} disabled={pending}>Approve estimate</Button>
						<Button variant="outline" onclick={() => decide(false)} disabled={pending}
							>Decline</Button
						>
					</div>
				</Card.Content>
			</Card.Root>
		{/if}
	</main>
</div>
