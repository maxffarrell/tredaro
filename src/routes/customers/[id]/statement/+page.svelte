<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '#lib/components/ui/button/index.js';
	import Printer from '@lucide/svelte/icons/printer';
	import { getCustomer } from '#lib/remote/customers.remote.ts';
	import { getSettings } from '#lib/remote/workspace.remote.ts';
	import { formatMoney } from '#lib/format.ts';
	import { localDate } from '#lib/tz.ts';

	const id = page.params.id!;
	const c = await getCustomer(id);
	const settings = await getSettings();
	const tz = settings.timezone;

	const cust = c.customer;
	const money = (cents: number) => formatMoney(cents, settings.currency, true);

	const openRows = c.charges
		.filter((r) => r.charge.status === 'open' && r.charge.amount > 0)
		.map((r) => ({ ...r, balance: r.charge.amount - r.paid }))
		.filter((r) => r.balance > 0)
		.sort((a, b) => a.charge.dueDate.localeCompare(b.charge.dueDate));
	const balanceDue = openRows.reduce((s, r) => s + r.balance, 0);
	const todayIso = localDate(new Date(), tz);
	const payments = c.payments
		.filter((p) => !p.refundedAt)
		.slice()
		.sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime())
		.slice(0, 15);
	const addr = c.locations
		.filter((l) => l.isPrimary)
		.map((l) => [l.address1, l.city, l.state, l.zip].filter(Boolean).join(', '))[0];
</script>

<svelte:head><title>Statement — {cust.name}</title></svelte:head>

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
					{#if settings.phone}<p class="text-sm">{settings.phone}</p>{/if}
					{#if settings.licenseNumber}<p class="text-sm">Lic. #{settings.licenseNumber}</p>{/if}
				</div>
				<div class="text-right">
					<h1 class="text-2xl font-bold tracking-tight">Statement</h1>
					<p class="text-sm text-neutral-600">{localDate(new Date(), tz)}</p>
				</div>
			</div>
		</header>

		<div class="mt-4 grid grid-cols-2 gap-4 text-sm">
			<div>
				<p class="font-semibold tracking-wide text-neutral-500 uppercase">Bill to</p>
				<p class="font-medium">{cust.companyName ? `${cust.companyName} — ` : ''}{cust.name}</p>
				{#if addr}<p>{addr}</p>{/if}
				{#if cust.email}<p>{cust.email}</p>{/if}
				{#if cust.phone}<p>{cust.phone}</p>{/if}
			</div>
			<div class="text-right">
				<p class="font-semibold tracking-wide text-neutral-500 uppercase">Balance due</p>
				<p class="text-2xl font-bold">{money(balanceDue)}</p>
			</div>
		</div>

		<div class="mt-4 text-sm">
			<p class="font-semibold tracking-wide text-neutral-500 uppercase">Open charges</p>
			<table class="mt-1 w-full">
				<thead>
					<tr class="border-b text-left">
						<th class="py-1">Due</th>
						<th class="py-1">Description</th>
						<th class="py-1 text-right">Amount</th>
						<th class="py-1 text-right">Paid</th>
						<th class="py-1 text-right">Balance</th>
					</tr>
				</thead>
				<tbody>
					{#each openRows as r (r.charge.id)}
						<tr class="border-b border-neutral-200">
							<td class="py-1 whitespace-nowrap">
								{r.charge.dueDate}{#if r.charge.dueDate < todayIso}
									<span class="font-medium"> — overdue</span>{/if}
							</td>
							<td class="py-1">{r.charge.description || r.charge.kind}</td>
							<td class="py-1 text-right tabular-nums">{money(r.charge.amount)}</td>
							<td class="py-1 text-right tabular-nums">{money(r.paid)}</td>
							<td class="py-1 text-right font-medium tabular-nums">{money(r.balance)}</td>
						</tr>
					{:else}
						<tr><td colspan="5" class="py-2 text-neutral-500">No open charges.</td></tr>
					{/each}
				</tbody>
				{#if openRows.length}
					<tfoot>
						<tr class="font-bold">
							<td class="py-1" colspan="4">Total due</td>
							<td class="py-1 text-right tabular-nums">{money(balanceDue)}</td>
						</tr>
					</tfoot>
				{/if}
			</table>
		</div>

		{#if payments.length}
			<div class="mt-4 break-inside-avoid text-sm">
				<p class="font-semibold tracking-wide text-neutral-500 uppercase">Recent payments</p>
				<table class="mt-1 w-full">
					<thead>
						<tr class="border-b text-left">
							<th class="py-1">Date</th>
							<th class="py-1">Method</th>
							<th class="py-1">Reference</th>
							<th class="py-1 text-right">Amount</th>
						</tr>
					</thead>
					<tbody>
						{#each payments as p (p.id)}
							<tr class="border-b border-neutral-200">
								<td class="py-1 whitespace-nowrap">{localDate(p.paidAt, tz)}</td>
								<td class="py-1 capitalize">{p.method}</td>
								<td class="py-1">{p.reference ?? '—'}</td>
								<td class="py-1 text-right tabular-nums">{money(p.amount)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		<p class="mt-6 text-center text-xs text-neutral-400">
			{settings.orgName} · statement printed {localDate(new Date(), tz)} · please reference your account
			name on payment
		</p>
	</div>
</div>
