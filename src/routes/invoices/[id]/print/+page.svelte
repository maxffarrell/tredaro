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
	const status = $derived(
		balance <= 0
			? 'paid'
			: new Date(inv.invoice.dueDate) < new Date()
				? 'overdue'
				: inv.invoice.status
	);

	const billTo = [
		inv.customer.companyName
			? `${inv.customer.companyName} — ${inv.customer.name}`
			: inv.customer.name,
		inv.customer.email,
		inv.customer.phone
	].filter(Boolean) as string[];
</script>

<svelte:head><title>Invoice INV-{inv.invoice.number}</title></svelte:head>

<div class="min-h-screen bg-neutral-100 text-neutral-900 print:bg-white">
	<div class="mx-auto max-w-4xl px-6 py-10 print:p-0">
		<div class="mb-6 flex items-start justify-between print:hidden">
			<Button variant="outline" onclick={() => history.back()}>Back</Button>
			<Button onclick={() => window.print()}><Printer /> Print</Button>
		</div>

		<div class="bg-white px-14 py-14 print:px-0 print:py-0">
			<header class="flex items-start justify-between">
				<div>
					<p class="text-lg font-semibold">{settings.orgName}</p>
					<p class="mt-1 text-neutral-500">Invoice INV-{inv.invoice.number}</p>
				</div>
				<dl class="w-72 space-y-5">
					<div class="grid grid-cols-[8rem_1fr] gap-x-4">
						<dt class="text-sm text-neutral-400">From</dt>
						<dd class="text-sm">
							{settings.orgName}
							{#if settings.address}<br />{settings.address}{/if}
							{#if settings.phone}<br />{settings.phone}{/if}
							{#if settings.licenseNumber}<br />Lic. #{settings.licenseNumber}{/if}
						</dd>
					</div>
					<div class="grid grid-cols-[8rem_1fr] gap-x-4">
						<dt class="text-sm text-neutral-400">Billed to</dt>
						<dd class="text-sm">
							{#each billTo as line (line)}
								{line}<br />
							{/each}
						</dd>
					</div>
					<div class="grid grid-cols-[8rem_1fr] gap-x-4">
						<dt class="text-sm text-neutral-400">Billing date</dt>
						<dd class="text-sm">{formatDate(inv.invoice.issuedAt)}</dd>
						<dt class="text-sm text-neutral-400">Due date</dt>
						<dd class="text-sm">{formatDate(inv.invoice.dueDate)}</dd>
						{#if inv.jobNumber}
							<dt class="text-sm text-neutral-400">Job</dt>
							<dd class="text-sm">J-{inv.jobNumber}</dd>
						{/if}
						<dt class="text-sm text-neutral-400">Status</dt>
						<dd class="text-sm capitalize">{status}</dd>
					</div>
				</dl>
			</header>

			<h1 class="mt-16 text-right text-7xl font-bold tracking-tight">Invoice</h1>

			<table class="mt-12 w-full border-t border-neutral-200 text-sm">
				<thead>
					<tr>
						<th class="py-3 text-left font-medium">Service</th>
						<th class="py-3 text-left font-medium">Quantity × rate</th>
						<th class="w-40 py-3 text-right font-medium">
							Amount {settings.currency.toUpperCase()}
						</th>
					</tr>
				</thead>
				<tbody>
					{#each inv.items as i (i.id)}
						<tr>
							<td class="py-2">
								{i.name}
								{#if i.description}
									<span class="block text-neutral-500">{i.description}</span>
								{/if}
							</td>
							<td class="py-2 text-neutral-500">
								{i.qty} × {formatMoney(i.unitPrice, settings.currency)}
							</td>
							<td class="py-2 text-right tabular-nums">
								{formatMoney(i.qty * i.unitPrice, settings.currency)}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>

			<div class="mt-8 flex justify-end">
				<dl class="w-72 space-y-1.5 text-sm">
					<div class="grid grid-cols-2 gap-x-4">
						<dt class="text-neutral-500">Subtotal</dt>
						<dd class="text-right tabular-nums">{formatMoney(total, settings.currency)}</dd>
						{#if paid > 0}
							<dt class="text-neutral-500">Paid</dt>
							<dd class="text-right tabular-nums">
								-{formatMoney(paid, settings.currency)}
							</dd>
						{/if}
					</div>
					<div class="grid grid-cols-2 gap-x-4 border-t border-neutral-200 pt-2 text-lg">
						<dt>Total {settings.currency.toUpperCase()}</dt>
						<dd class="text-right font-semibold tabular-nums">
							{formatMoney(paid > 0 ? balance : total, settings.currency)}
						</dd>
					</div>
				</dl>
			</div>

			{#if inv.invoice.notes}
				<p class="mt-12 text-sm whitespace-pre-wrap text-neutral-500">
					{inv.invoice.notes}
				</p>
			{/if}

			<footer class="mt-14 text-sm">
				<p class="font-semibold">Payment details</p>
				<dl class="mt-3 grid grid-cols-[10rem_1fr] gap-y-1">
					{#if settings.phone}
						<dt class="text-neutral-500">Phone</dt>
						<dd>{settings.phone}</dd>
					{/if}
					<dt class="text-neutral-500">Reference</dt>
					<dd>INV-{inv.invoice.number}</dd>
				</dl>
				<p class="mt-10 text-xs text-neutral-500">
					Payment is due by {formatDate(inv.invoice.dueDate)}. Please reference INV-{inv.invoice
						.number} on your payment.
				</p>
				{#if settings.logoUrl}
					<img src={settings.logoUrl} alt={settings.orgName} class="mt-6 h-8 object-contain" />
				{/if}
			</footer>
		</div>
	</div>
</div>
