<script lang="ts">
	import { page } from '$app/state';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import Printer from '@lucide/svelte/icons/printer';
	import { toast } from 'svelte-sonner';
	import { payPublicInvoice } from '#lib/remote/public.remote.ts';
	import Logo from '#lib/components/app/logo.svelte';
	import { errMsg, formatMoney } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const {
		invoice: inv,
		orgName,
		customerName,
		items,
		total,
		paid,
		currency,
		providers,
		footer,
		orgPhone,
		orgWebsite,
		reviewUrl,
		tips,
		payments,
		visit
	} = $derived(data);
	const balance = $derived(total - paid);
	const paidOff = $derived(
		inv.status === 'void' || balance <= 0 || page.url.searchParams.has('paid')
	);

	let paying = $state(false);
	let tipPct = $state(0);
	const tipAmount = $derived(Math.round((balance * tipPct) / 100));
	async function pay(provider: string) {
		paying = true;
		try {
			const { url } = await payPublicInvoice({
				token: page.params.token!,
				provider,
				tipPct
			});
			location.assign(url);
		} catch (err) {
			paying = false;
			toast.error(errMsg(err, 'Could not start payment'));
		}
	}
</script>

<svelte:head>
	<title>Invoice INV-{inv.number} — {orgName}</title>
</svelte:head>

<div class="min-h-svh bg-muted/30">
	<header class="border-b bg-background print:hidden">
		<div class="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
			<Logo />
			<span class="truncate font-semibold">{orgName}</span>
			{#if orgPhone || orgWebsite}
				<span class="ml-auto truncate text-xs text-muted-foreground">
					{#if orgPhone}{orgPhone}{/if}{#if orgPhone && orgWebsite}
						·
					{/if}{#if orgWebsite}<a
							class="hover:underline"
							href={orgWebsite.startsWith('http') ? orgWebsite : `https://${orgWebsite}`}
							target="_blank"
							rel="noreferrer">{orgWebsite.replace(/^https?:\/\//, '')}</a
						>{/if}
				</span>
			{/if}
		</div>
	</header>

	<main class="mx-auto max-w-3xl space-y-6 p-4 py-8">
		<div class="flex items-center justify-between gap-3">
			<div>
				<h1 class="text-2xl font-semibold tracking-tight">Invoice INV-{inv.number}</h1>
				<p class="text-sm text-muted-foreground">
					For {customerName} · due {inv.dueDate}
					{#if visit?.startsAt && visit.status !== 'done' && visit.status !== 'cancelled'}
						· visit {new Date(visit.startsAt).toLocaleDateString('en-US', {
							weekday: 'short',
							month: 'short',
							day: 'numeric'
						})}
					{/if}
				</p>
			</div>
			<div class="flex items-center gap-2">
				<StatusBadge status={inv.status === 'void' ? 'void' : paidOff ? 'paid' : inv.status} />
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
				<div class="space-y-1 border-t px-6 py-3 text-sm tabular-nums">
					<div class="flex justify-between font-semibold">
						<span>Total</span><span>{formatMoney(total, currency)}</span>
					</div>
					{#if paid > 0}
						<div class="flex justify-between text-muted-foreground">
							<span>Paid</span><span>-{formatMoney(paid, currency)}</span>
						</div>
					{/if}
					<div class="flex justify-between font-semibold">
						<span>Balance due</span><span>{formatMoney(balance, currency)}</span>
					</div>
				</div>
			</Card.Content>
		</Card.Root>

		{#if payments.length}
			<Card.Root>
				<Card.Header><Card.Title class="text-base">Payment history</Card.Title></Card.Header>
				<Card.Content class="px-6">
					<ul class="divide-y text-sm">
						{#each payments as p (p.paidAt)}
							<li class="flex justify-between gap-3 py-1.5">
								<span class="text-muted-foreground"
									>{new Date(p.paidAt).toLocaleDateString('en-US', {
										month: 'short',
										day: 'numeric',
										year: 'numeric'
									})} · {p.method}{p.isTip ? ' · tip' : ''}</span
								>
								<span class="font-medium tabular-nums">{formatMoney(p.amount, currency)}</span>
							</li>
						{/each}
					</ul>
				</Card.Content>
			</Card.Root>
		{/if}

		{#if inv.notes}
			<Card.Root>
				<Card.Header><Card.Title class="text-base">Notes</Card.Title></Card.Header>
				<Card.Content class="px-6 text-sm whitespace-pre-wrap">{inv.notes}</Card.Content>
			</Card.Root>
		{/if}

		{#if inv.status === 'void'}
			<Card.Root>
				<Card.Content class="py-6 text-center">
					<p class="font-semibold">This invoice was voided</p>
					<p class="mt-1 text-sm text-muted-foreground">Contact {orgName} with questions.</p>
				</Card.Content>
			</Card.Root>
		{:else if balance <= 0}
			<Card.Root class="border-emerald-500/50">
				<Card.Content class="py-6 text-center">
					<p class="font-semibold">Paid in full</p>
					<p class="mt-1 text-sm text-muted-foreground">Thanks, {customerName}.</p>
					{#if tips > 0}
						<p class="mt-1 text-sm text-muted-foreground">
							Includes a {formatMoney(tips, currency)} tip for the crew — much appreciated.
						</p>
					{/if}
					{#if reviewUrl}
						<Button class="mt-3" size="sm" variant="outline" href={reviewUrl} target="_blank"
							>Loved the work? Leave a review</Button
						>
					{/if}
				</Card.Content>
			</Card.Root>
		{:else if providers.length}
			<Card.Root class="print:hidden">
				<Card.Header>
					<Card.Title class="text-base">Pay {formatMoney(balance, currency)}</Card.Title>
					<Card.Description>Pay this invoice online — secure checkout.</Card.Description>
				</Card.Header>
				<Card.Content class="px-6">
					<div class="mb-3">
						<p class="mb-1.5 text-sm text-muted-foreground">Add a tip for the crew</p>
						<div class="flex flex-wrap gap-2">
							{#each [0, 10, 15, 20] as pct (pct)}
								<Button
									size="sm"
									variant={tipPct === pct ? 'default' : 'outline'}
									onclick={() => (tipPct = pct)}>{pct === 0 ? 'No tip' : `${pct}%`}</Button
								>
							{/each}
							{#if tipAmount > 0}
								<span class="self-center text-sm text-muted-foreground"
									>+{formatMoney(tipAmount, currency)} tip · total
									{formatMoney(balance + tipAmount, currency)}</span
								>
							{/if}
						</div>
					</div>
					<div class="flex flex-wrap gap-2">
						{#each providers as p (p.id)}
							<Button onclick={() => pay(p.id)} disabled={paying}>{p.payLabel}</Button>
						{/each}
					</div>
				</Card.Content>
			</Card.Root>
		{:else}
			<Card.Root>
				<Card.Content class="py-6 text-center">
					<p class="font-semibold">Amount due: {formatMoney(balance, currency)}</p>
					<p class="mt-1 text-sm text-muted-foreground">
						{orgName} hasn't enabled online payment — contact them to pay.
					</p>
				</Card.Content>
			</Card.Root>
		{/if}
		{#if footer}
			<p class="px-1 text-xs whitespace-pre-wrap text-muted-foreground">{footer}</p>
		{/if}
	</main>
</div>
