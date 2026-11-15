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

	const preparedFor = [
		est.customer.companyName
			? `${est.customer.companyName} — ${est.customer.name}`
			: est.customer.name,
		addr,
		est.customer.email
	].filter(Boolean) as string[];
</script>

<svelte:head><title>Estimate E-{est.estimate.number}</title></svelte:head>

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
					<p class="mt-1 text-neutral-500">
						Estimate E-{est.estimate.number}{est.estimate.version > 1
							? ` v${est.estimate.version}`
							: ''}
					</p>
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
						<dt class="text-sm text-neutral-400">Prepared for</dt>
						<dd class="text-sm">
							{#each preparedFor as line (line)}
								{line}<br />
							{/each}
						</dd>
					</div>
					<div class="grid grid-cols-[8rem_1fr] gap-x-4">
						<dt class="text-sm text-neutral-400">Issued</dt>
						<dd class="text-sm">{formatDate(est.estimate.createdAt)}</dd>
						{#if est.estimate.validUntil}
							<dt class="text-sm text-neutral-400">Valid until</dt>
							<dd class="text-sm">{formatDate(est.estimate.validUntil)}</dd>
						{/if}
						{#if est.estimate.customerPo}
							<dt class="text-sm text-neutral-400">PO</dt>
							<dd class="text-sm">{est.estimate.customerPo}</dd>
						{/if}
						<dt class="text-sm text-neutral-400">Status</dt>
						<dd class="text-sm capitalize">{est.estimate.status}</dd>
					</div>
				</dl>
			</header>

			<h1 class="mt-16 text-right text-7xl font-bold tracking-tight">Estimate</h1>

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
					{#each est.items as i (i.item.id)}
						<tr>
							<td class="py-2">
								{i.item.name}
								{#if i.item.description}
									<span class="block text-neutral-500">{i.item.description}</span>
								{/if}
							</td>
							<td class="py-2 text-neutral-500">
								{i.item.qty} × {formatMoney(i.item.unitPrice, settings.currency)}
							</td>
							<td class="py-2 text-right tabular-nums">
								{formatMoney(i.item.qty * i.item.unitPrice, settings.currency)}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>

			<div class="mt-8 flex justify-end">
				<dl class="w-72 text-sm">
					<div class="grid grid-cols-2 gap-x-4 border-t border-neutral-200 pt-2 text-lg">
						<dt>Total {settings.currency.toUpperCase()}</dt>
						<dd class="text-right font-semibold tabular-nums">
							{formatMoney(total, settings.currency)}
						</dd>
					</div>
				</dl>
			</div>

			{#if est.estimate.notes}
				<p class="mt-12 text-sm whitespace-pre-wrap text-neutral-500">
					{est.estimate.notes}
				</p>
			{/if}

			{#if settings.estimateFooter}
				<p class="mt-8 text-xs whitespace-pre-wrap text-neutral-500">
					{settings.estimateFooter}
				</p>
			{/if}

			<footer class="mt-14 text-sm">
				<p class="font-semibold">Approval</p>
				{#if est.estimate.status === 'approved' || est.estimate.status === 'converted'}
					<p class="mt-4">Approved by {est.estimate.decisionName ?? 'customer'}</p>
				{:else}
					<dl class="mt-8 grid grid-cols-[10rem_1fr] gap-y-10">
						<dt class="text-neutral-500">Signature</dt>
						<dd class="w-64 border-b border-neutral-300"></dd>
						<dt class="text-neutral-500">Printed name / date</dt>
						<dd class="w-64 border-b border-neutral-300"></dd>
					</dl>
				{/if}
				{#if settings.logoUrl}
					<img src={settings.logoUrl} alt={settings.orgName} class="mt-10 h-8 object-contain" />
				{/if}
			</footer>
		</div>
	</div>
</div>
