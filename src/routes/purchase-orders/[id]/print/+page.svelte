<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '#lib/components/ui/button/index.js';
	import Printer from '@lucide/svelte/icons/printer';
	import { getPurchaseOrders } from '#lib/remote/inventory.remote.ts';
	import { getSettings } from '#lib/remote/workspace.remote.ts';
	import { formatDate, formatMoney } from '#lib/format.ts';

	const id = page.params.id!;
	const pos = await getPurchaseOrders();
	const p = pos.find((x) => x.po.id === id)!;
	const settings = await getSettings();
	const total = p.items.reduce((sum, i) => sum + i.qty * i.unitCost, 0);
</script>

<svelte:head><title>Purchase order PO-{p.po.number}</title></svelte:head>

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
					<h1 class="text-2xl font-bold tracking-tight">Purchase order</h1>
					<p class="text-lg font-semibold">PO-{p.po.number}</p>
					<p class="text-sm capitalize">{p.po.status}</p>
				</div>
			</div>
		</header>

		<div class="mt-4 grid grid-cols-2 gap-4 text-sm">
			<div>
				<p class="font-semibold tracking-wide text-neutral-500 uppercase">Supplier</p>
				<p class="font-medium">{p.po.supplier}</p>
				{#if p.jobNumber}<p class="mt-1">For job J-{p.jobNumber}</p>{/if}
			</div>
			<div class="text-right">
				<p class="font-semibold tracking-wide text-neutral-500 uppercase">Details</p>
				{#if p.po.orderedAt}<p>Ordered {formatDate(p.po.orderedAt)}</p>{/if}
				{#if p.po.expectedOn}<p>Expected {p.po.expectedOn}</p>{/if}
				{#if p.po.receivedAt}<p>Received {formatDate(p.po.receivedAt)}</p>{/if}
			</div>
		</div>

		<table class="mt-6 w-full text-sm">
			<thead>
				<tr class="border-b text-left">
					<th class="py-1 font-semibold tracking-wide text-neutral-500 uppercase">Item</th>
					<th class="py-1 text-right font-semibold tracking-wide text-neutral-500 uppercase">Qty</th
					>
					<th class="py-1 pl-4 font-semibold tracking-wide text-neutral-500 uppercase">Unit</th>
					<th class="py-1 text-right font-semibold tracking-wide text-neutral-500 uppercase"
						>Unit cost</th
					>
					<th class="py-1 pr-1 text-right font-semibold tracking-wide text-neutral-500 uppercase"
						>Total</th
					>
				</tr>
			</thead>
			<tbody>
				{#each p.items as i (i.id)}
					<tr class="border-b border-neutral-200">
						<td class="py-1.5">{i.name}</td>
						<td class="py-1.5 text-right tabular-nums">{i.qty}</td>
						<td class="py-1.5 pl-4">{i.unit}</td>
						<td class="py-1.5 text-right tabular-nums">{formatMoney(i.unitCost)}</td>
						<td class="py-1.5 pr-1 text-right tabular-nums">{formatMoney(i.qty * i.unitCost)}</td>
					</tr>
				{/each}
			</tbody>
			<tfoot>
				<tr class="border-t-2 border-neutral-800 font-semibold">
					<td colspan="4" class="py-2">Total</td>
					<td class="py-2 pr-1 text-right tabular-nums">{formatMoney(total)}</td>
				</tr>
			</tfoot>
		</table>

		{#if p.po.notes}
			<div class="mt-4 text-sm">
				<p class="font-semibold tracking-wide text-neutral-500 uppercase">Notes</p>
				<p class="mt-1 whitespace-pre-wrap">{p.po.notes}</p>
			</div>
		{/if}
	</div>
</div>
