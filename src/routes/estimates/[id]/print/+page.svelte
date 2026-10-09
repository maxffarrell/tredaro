<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '#lib/components/ui/button/index.js';
	import Printer from '@lucide/svelte/icons/printer';
	import { getEstimate } from '#lib/remote/estimates.remote.ts';
	import { getSettings } from '#lib/remote/workspace.remote.ts';
	import { formatDate, formatMoney } from '#lib/format.ts';

	const id = page.params.id!;
	const est = await getEstimate(id);
	const settings = await getSettings();

	const addr = [
		est.location?.label ? `${est.location.label}:` : '',
		est.location?.address1,
		est.location?.city,
		est.location?.state
	]
		.filter(Boolean)
		.join(' ');
	const total = est.items.reduce((sum, i) => sum + i.item.qty * i.item.unitPrice, 0);
</script>

<svelte:head><title>Estimate E-{est.estimate.number}</title></svelte:head>

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
					<h1 class="text-2xl font-bold tracking-tight">Estimate</h1>
					<p class="text-lg font-semibold">
						E-{est.estimate.number}{est.estimate.version > 1 ? ` v${est.estimate.version}` : ''}
					</p>
				</div>
			</div>
		</header>

		<div class="mt-4 grid grid-cols-2 gap-4 text-sm">
			<div>
				<p class="font-semibold tracking-wide text-neutral-500 uppercase">Prepared for</p>
				<p class="font-medium">
					{est.customer.companyName ? `${est.customer.companyName} — ` : ''}{est.customer.name}
				</p>
				{#if addr}<p>{addr}</p>{/if}
				{#if est.customer.email}<p>{est.customer.email}</p>{/if}
			</div>
			<div class="text-right">
				<p class="font-semibold tracking-wide text-neutral-500 uppercase">Details</p>
				<p>Issued {formatDate(est.estimate.createdAt)}</p>
				{#if est.estimate.validUntil}<p>Valid until {formatDate(est.estimate.validUntil)}</p>{/if}
				{#if est.estimate.customerPo}<p>PO: {est.estimate.customerPo}</p>{/if}
				<p class="capitalize">Status: {est.estimate.status}</p>
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
				{#each est.items as i (i.item.id)}
					<tr class="border-b border-neutral-200">
						<td class="py-1.5">
							{i.item.name}
							{#if i.item.description}
								<span class="block text-xs text-neutral-500">{i.item.description}</span>
							{/if}
						</td>
						<td class="py-1.5 text-right">{i.item.qty}</td>
						<td class="py-1.5 text-right tabular-nums"
							>{formatMoney(i.item.unitPrice, settings.currency)}</td
						>
						<td class="py-1.5 text-right tabular-nums"
							>{formatMoney(i.item.qty * i.item.unitPrice, settings.currency)}</td
						>
					</tr>
				{/each}
				<tr>
					<td colspan="3" class="py-2 text-right font-semibold">Total</td>
					<td class="py-2 text-right font-semibold tabular-nums"
						>{formatMoney(total, settings.currency)}</td
					>
				</tr>
			</tbody>
		</table>

		{#if est.estimate.notes}
			<div class="mt-4 text-sm">
				<p class="font-semibold tracking-wide text-neutral-500 uppercase">Notes</p>
				<p class="mt-1 whitespace-pre-wrap">{est.estimate.notes}</p>
			</div>
		{/if}

		<div class="mt-10 text-sm">
			<p class="font-semibold tracking-wide text-neutral-500 uppercase">Approval</p>
			{#if est.estimate.status === 'approved' || est.estimate.status === 'converted'}
				<p class="mt-4">Approved by {est.estimate.decisionName ?? 'customer'}</p>
			{:else}
				<p class="mt-8 w-64 border-b border-neutral-400 pb-1">Signature</p>
				<p class="mt-4 w-64 border-b border-neutral-400 pb-1">Printed name / date</p>
			{/if}
		</div>
	</div>
</div>
