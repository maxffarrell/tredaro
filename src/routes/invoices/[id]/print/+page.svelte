<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '#lib/components/ui/button/index.js';
	import Printer from '@lucide/svelte/icons/printer';
	import { getInvoice } from '#lib/remote/billing.remote.ts';
	import { getSettings } from '#lib/remote/workspace.remote.ts';
	import { formatDate, formatMoney } from '#lib/format.ts';

	const id = page.params.id!;
	const inv = await getInvoice(id);
	const settings = await getSettings();

	const total = inv.items.reduce((sum, i) => sum + i.qty * i.unitPrice, 0);
	const paid = inv.charges.reduce((sum, c) => sum + c.paid, 0);
	const balance = total - paid;
</script>

<svelte:head><title>Invoice INV-{inv.invoice.number}</title></svelte:head>

<div class="min-h-screen bg-white text-neutral-900">
	<div class="mx-auto max-w-3xl p-6 print:p-0">
		<div class="flex items-start justify-between print:hidden">
			<Button variant="outline" onclick={() => history.back()}>Back</Button>
			<Button onclick={() => window.print()}><Printer /> Print</Button>
		</div>

		<header class="mt-4 border-b-2 border-neutral-800 pb-4 print:mt-0">
			<div class="flex items-start justify-between">
				<div>
					{#if settings.logoUrl}
						<img src={settings.logoUrl} alt={settings.orgName} class="mb-2 h-12 object-contain" />
					{/if}
					<p class="text-lg font-bold">{settings.orgName}</p>
					{#if settings.address}<p class="text-sm">{settings.address}</p>{/if}
					{#if settings.phone}<p class="text-sm">{settings.phone}</p>{/if}
					{#if settings.licenseNumber}<p class="text-sm">Lic. #{settings.licenseNumber}</p>{/if}
				</div>
				<div class="text-right">
					<h1 class="text-2xl font-bold tracking-tight">Invoice</h1>
					<p class="text-lg font-semibold">INV-{inv.invoice.number}</p>
				</div>
			</div>
		</header>

		<div class="mt-4 grid grid-cols-2 gap-4 text-sm">
			<div>
				<p class="font-semibold tracking-wide text-neutral-500 uppercase">Bill to</p>
				<p class="font-medium">
					{inv.customer.companyName ? `${inv.customer.companyName} — ` : ''}{inv.customer.name}
				</p>
				{#if inv.customer.email}<p>{inv.customer.email}</p>{/if}
				{#if inv.customer.phone}<p>{inv.customer.phone}</p>{/if}
			</div>
			<div class="text-right">
				<p class="font-semibold tracking-wide text-neutral-500 uppercase">Details</p>
				<p>Issued {formatDate(inv.invoice.issuedAt)}</p>
				<p>Due {formatDate(inv.invoice.dueDate)}</p>
				{#if inv.jobNumber}<p>Job J-{inv.jobNumber}</p>{/if}
				<p class="capitalize">Status: {inv.invoice.status}</p>
			</div>
		</div>

		<table class="mt-6 w-full text-sm">
			<thead>
				<tr class="border-b-2 border-neutral-800 text-left">
					<th class="py-1">Item</th>
					<th class="w-16 py-1 text-right">Qty</th>
					<th class="w-24 py-1 text-right">Unit</th>
					<th class="w-28 py-1 text-right">Amount</th>
				</tr>
			</thead>
			<tbody>
				{#each inv.items as i (i.id)}
					<tr class="border-b border-neutral-200">
						<td class="py-1.5">
							{i.name}
							{#if i.description}
								<span class="block text-xs text-neutral-500">{i.description}</span>
							{/if}
						</td>
						<td class="py-1.5 text-right">{i.qty}</td>
						<td class="py-1.5 text-right tabular-nums"
							>{formatMoney(i.unitPrice, settings.currency)}</td
						>
						<td class="py-1.5 text-right tabular-nums"
							>{formatMoney(i.qty * i.unitPrice, settings.currency)}</td
						>
					</tr>
				{/each}
				<tr>
					<td colspan="3" class="py-2 text-right font-semibold">Total</td>
					<td class="py-2 text-right font-semibold tabular-nums"
						>{formatMoney(total, settings.currency)}</td
					>
				</tr>
				{#if paid > 0}
					<tr>
						<td colspan="3" class="py-1 text-right text-neutral-600">Paid</td>
						<td class="py-1 text-right text-neutral-600 tabular-nums"
							>-{formatMoney(paid, settings.currency)}</td
						>
					</tr>
					<tr>
						<td colspan="3" class="py-1 text-right font-semibold">Balance due</td>
						<td class="py-1 text-right font-semibold tabular-nums"
							>{formatMoney(balance, settings.currency)}</td
						>
					</tr>
				{/if}
			</tbody>
		</table>

		{#if inv.invoice.notes}
			<div class="mt-4 text-sm">
				<p class="font-semibold tracking-wide text-neutral-500 uppercase">Notes</p>
				<p class="mt-1 whitespace-pre-wrap">{inv.invoice.notes}</p>
			</div>
		{/if}
	</div>
</div>
