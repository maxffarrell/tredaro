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
	import MoneyInput from '#lib/components/app/money-input.svelte';
	import { toast } from 'svelte-sonner';
	import { getEstimates, createEstimate } from '#lib/remote/estimates.remote.ts';
	import { getCustomers } from '#lib/remote/customers.remote.ts';
	import { getSettings } from '#lib/remote/workspace.remote.ts';
	import { errMsg, formatDate, formatMoney } from '#lib/format.ts';
	import Plus from '@lucide/svelte/icons/plus';
	import FileText from '@lucide/svelte/icons/file-text';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	const settings = await getSettings();
	const currency = settings.currency;
	const customers = await getCustomers();

	const TABS = [
		['all', 'All'],
		['draft', 'Drafts'],
		['sent', 'Sent'],
		['approved', 'Approved'],
		['declined', 'Declined'],
		['expired', 'Expired']
	] as const;
	let tab = $state(page.url.searchParams.get('status') ?? 'all');
	const estimates = $derived(
		await getEstimates(
			tab === 'all' ? undefined : { status: tab === 'approved' ? ['approved', 'converted'] : [tab] }
		)
	);

	// ------- new estimate -------
	let open = $state(page.url.searchParams.get('new') === '1');
	let pending = $state(false);
	let customerId = $state(page.url.searchParams.get('customer') ?? '');
	let notes = $state('');
	let items = $state([{ name: '', qty: 1, unitPrice: 0 }]);

	const totalCents = $derived(items.reduce((s, i) => s + i.qty * i.unitPrice, 0));
	const awaitingConversion = $derived(
		estimates.filter((e) => e.estimate.status === 'approved').length
	);
	const expiringSoon = $derived.by(() => {
		const in7 = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
		const today = new Date().toISOString().slice(0, 10);
		return estimates.filter(
			(e) =>
				e.estimate.status === 'sent' &&
				e.estimate.validUntil &&
				e.estimate.validUntil >= today &&
				e.estimate.validUntil <= in7
		).length;
	});
	const winRate = $derived.by(() => {
		const decided = estimates.filter(
			(e) =>
				e.estimate.status === 'approved' ||
				e.estimate.status === 'converted' ||
				e.estimate.status === 'declined'
		).length;
		if (!decided) return null;
		const won = estimates.filter(
			(e) => e.estimate.status === 'approved' || e.estimate.status === 'converted'
		).length;
		return Math.round((won / decided) * 100);
	});
	const oldestSentDays = $derived.by(() => {
		if (tab !== 'sent' || !estimates.length) return null;
		const ts = estimates
			.filter((e) => e.estimate.sentAt)
			.map((e) => new Date(e.estimate.sentAt!).getTime());
		if (!ts.length) return null;
		return Math.max(1, Math.floor((Date.now() - Math.min(...ts)) / 86400_000));
	});

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			const est = await createEstimate({
				customerId,
				notes,
				items: items
					.filter((i) => i.name.trim())
					.map((i) => ({ name: i.name, qty: i.qty, unitPrice: i.unitPrice }))
			}).updates(getEstimates);
			toast.success(`Estimate E-${est!.number} created`);
			open = false;
			await goto(`/estimates/${est!.id}`);
		} catch (err) {
			toast.error(errMsg(err, 'Could not create estimate'));
		}
		pending = false;
	}
</script>

<PageHeader title="Estimates">
	{#snippet actions()}
		<Button size="sm" onclick={() => (open = true)}><Plus /> New estimate</Button>
	{/snippet}
</PageHeader>

<div class="space-y-4 p-4 md:p-6">
	<Tabs.Root bind:value={tab}>
		<Tabs.List class="flex-wrap">
			{#each TABS as [value, label] (value)}
				<Tabs.Trigger {value}>{label}</Tabs.Trigger>
			{/each}
		</Tabs.List>
	</Tabs.Root>

	{#if tab === 'all' && estimates.length}
		<p class="text-sm text-muted-foreground">
			{formatMoney(
				estimates.reduce((s, e) => s + e.total, 0),
				currency
			)} across {estimates.length} estimate{estimates.length === 1 ? '' : 's'}{#if winRate !== null}
				· {winRate}% won (of decided){/if}{#if awaitingConversion}
				· {awaitingConversion} awaiting conversion{/if}
		</p>
	{/if}
	{#if tab === 'approved' && estimates.length}
		<p class="text-sm text-muted-foreground">
			Won: <span class="font-medium text-foreground"
				>{formatMoney(
					estimates.reduce((s, e) => s + e.total, 0),
					currency
				)}</span
			>
			across {estimates.length} approved estimate{estimates.length === 1 ? '' : 's'} · avg {formatMoney(
				estimates.length ? estimates.reduce((s, e) => s + e.total, 0) / estimates.length : 0,
				currency
			)}
		</p>
	{/if}

	{#if tab === 'sent' && estimates.length}
		<p class="text-sm text-muted-foreground">
			Open pipeline: <span class="font-medium text-foreground"
				>{formatMoney(
					estimates.reduce((s, e) => s + e.total, 0),
					currency
				)}</span
			>
			across {estimates.length} sent estimate{estimates.length === 1 ? '' : 's'} ·
			{estimates.filter((e) => e.viewed).length} viewed{#if expiringSoon}
				· {expiringSoon} expiring ≤7d{/if}{#if oldestSentDays !== null}
				· oldest sent {oldestSentDays}d ago{/if}
		</p>
	{/if}
	{#if tab === 'draft' && estimates.length}
		<p class="text-sm text-muted-foreground">
			Draft pipeline: <span class="font-medium text-foreground"
				>{formatMoney(
					estimates.reduce((s, e) => s + e.total, 0),
					currency
				)}</span
			>
			across {estimates.length} draft estimate{estimates.length === 1 ? '' : 's'} — send them to start
			the pipeline
		</p>
	{/if}
	{#if tab === 'declined' && estimates.length}
		<p class="text-sm text-muted-foreground">
			Lost pipeline: <span class="font-medium text-foreground"
				>{formatMoney(
					estimates.reduce((s, e) => s + e.total, 0),
					currency
				)}</span
			>
			across {estimates.length} declined estimate{estimates.length === 1 ? '' : 's'}
		</p>
	{/if}
	{#if tab === 'expired' && estimates.length}
		<p class="text-sm text-muted-foreground">
			Stale pipeline: <span class="font-medium text-foreground"
				>{formatMoney(
					estimates.reduce((s, e) => s + e.total, 0),
					currency
				)}</span
			>
			across {estimates.length} expired estimate{estimates.length === 1 ? '' : 's'} — consider revising
			or following up
		</p>
	{/if}
	<Card.Root class="py-0">
		<Card.Content class="px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Estimate</Table.Head>
						<Table.Head>Customer</Table.Head>
						<Table.Head class="hidden md:table-cell">Created</Table.Head>
						<Table.Head class="text-right">Total</Table.Head>
						<Table.Head>Status</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each estimates as e (e.estimate.id)}
						<Table.Row class="cursor-pointer" onclick={() => goto(`/estimates/${e.estimate.id}`)}>
							<Table.Cell class="font-medium">
								E-{e.estimate.number}
								{#if e.estimate.version > 1}
									<Badge variant="secondary" class="ml-1 font-normal">v{e.estimate.version}</Badge>
								{/if}
							</Table.Cell>
							<Table.Cell>{e.customerName}</Table.Cell>
							<Table.Cell class="hidden text-muted-foreground md:table-cell"
								>{e.estimate.sentAt
									? `sent ${formatDate(e.estimate.sentAt)}`
									: formatDate(e.estimate.createdAt)}</Table.Cell
							>
							<Table.Cell class="text-right tabular-nums"
								>{formatMoney(e.total, currency)}</Table.Cell
							>
							<Table.Cell>
								<StatusBadge status={e.estimate.status} />
								{#if e.viewed && e.estimate.status === 'sent'}
									<Badge variant="secondary" title="Customer opened this estimate">Viewed</Badge>
								{/if}
								{#if e.estimate.decisionNote?.includes('Changes requested')}
									<Badge
										variant="secondary"
										class="ml-1 border-amber-200 bg-amber-100 font-normal text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
										>Changes</Badge
									>
								{/if}
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell colspan={5}>
								<Empty.Root class="border-0">
									<Empty.Header>
										<Empty.Media><FileText /></Empty.Media>
										<Empty.Title>No estimates</Empty.Title>
										<Empty.Description>Price out the first job.</Empty.Description>
									</Empty.Header>
									<Empty.Content
										><Button onclick={() => (open = true)}>New estimate</Button></Empty.Content
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
	<Dialog.Content class="sm:max-w-xl">
		<Dialog.Header>
			<Dialog.Title>New estimate</Dialog.Title>
			<Dialog.Description
				>Line items in {currency}. You can send it after it's created.</Dialog.Description
			>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={submit}>
			<Field.Field>
				<Field.Label>Customer</Field.Label>
				<Select.Root type="single" bind:value={customerId}>
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
			<div class="space-y-2">
				<p class="text-sm font-medium">Items</p>
				{#each items as item, i (i)}
					<div class="grid grid-cols-[1fr_70px_110px_32px] items-center gap-2">
						<Input placeholder="Description" bind:value={item.name} />
						<Input
							type="number"
							min={0.01}
							step={0.01}
							max={9999}
							bind:value={item.qty}
							placeholder="Qty"
						/>
						<MoneyInput bind:value={item.unitPrice} />
						<Button
							variant="ghost"
							size="icon"
							class="size-8"
							disabled={items.length === 1}
							onclick={() => items.splice(i, 1) && (items = items)}
							><Trash2 class="size-4" /></Button
						>
					</div>
				{/each}
				<div class="flex items-center justify-between">
					<Button
						variant="outline"
						size="sm"
						onclick={() => (items = [...items, { name: '', qty: 1, unitPrice: 0 }])}
						><Plus /> Add item</Button
					>
					<span class="text-sm font-medium tabular-nums">{formatMoney(totalCents, currency)}</span>
				</div>
			</div>
			<Field.Field>
				<Field.Label for="e-notes">Notes</Field.Label>
				<Textarea id="e-notes" rows={3} bind:value={notes} placeholder="Terms, exclusions, etc." />
			</Field.Field>
			<Dialog.Footer>
				<Button type="submit" disabled={pending || !customerId}
					>{pending ? 'Creating…' : 'Create estimate'}</Button
				>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
