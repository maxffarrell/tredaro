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
	const jobs = c.jobs
		.slice()
		.sort(
			(a, b) =>
				(b.job.startsAt?.getTime() ?? b.job.createdAt.getTime()) -
				(a.job.startsAt?.getTime() ?? a.job.createdAt.getTime())
		);
	const addr = c.locations
		.filter((l) => l.isPrimary)
		.map((l) => [l.address1, l.city, l.state, l.zip].filter(Boolean).join(', '))[0];
	const activePlans = c.agreements.filter((a) => a.agreement.status === 'active');
</script>

<svelte:head><title>Service history — {cust.name}</title></svelte:head>

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
					<h1 class="text-2xl font-bold tracking-tight">Service history</h1>
					<p class="text-sm text-neutral-600">{localDate(new Date(), tz)}</p>
				</div>
			</div>
		</header>

		<div class="mt-4 grid grid-cols-2 gap-4 text-sm">
			<div>
				<p class="font-semibold tracking-wide text-neutral-500 uppercase">Customer</p>
				<p class="font-medium">{cust.companyName ? `${cust.companyName} — ` : ''}{cust.name}</p>
				{#if addr}<p>{addr}</p>{/if}
				{#if cust.email}<p>{cust.email}</p>{/if}
				{#if cust.phone}<p>{cust.phone}</p>{/if}
			</div>
			<div>
				<p class="font-semibold tracking-wide text-neutral-500 uppercase">Account</p>
				{#if cust.since}<p>Customer since {cust.since}</p>{/if}
				<p>
					{c.stats.jobCount} job{c.stats.jobCount === 1 ? '' : 's'} · invoiced {formatMoney(
						c.stats.invoiced,
						settings.currency,
						true
					)} · collected {formatMoney(c.stats.collected, settings.currency, true)}
				</p>
				{#if activePlans.length}
					<p>
						{#each activePlans as a (a.agreement.id)}
							{a.planName} ({formatMoney(
								a.amount,
								settings.currency,
								true
							)}/{a.interval}){#if a.agreement.nextChargeAt}
								— next bill {localDate(a.agreement.nextChargeAt, tz)}{/if}
						{/each}
					</p>
				{/if}
			</div>
		</div>

		<div class="mt-4 text-sm">
			<p class="font-semibold tracking-wide text-neutral-500 uppercase">Visits</p>
			<table class="mt-1 w-full">
				<thead>
					<tr class="border-b text-left">
						<th class="py-1">Date</th>
						<th class="py-1">Job</th>
						<th class="py-1">Work</th>
						<th class="py-1">Tech</th>
						<th class="py-1 text-right">Status</th>
					</tr>
				</thead>
				<tbody>
					{#each jobs as j (j.job.id)}
						<tr class="border-b border-neutral-200">
							<td class="py-1 whitespace-nowrap">
								{#if j.job.startsAt}{localDate(j.job.startsAt, tz)}{:else}—{/if}
							</td>
							<td class="py-1 whitespace-nowrap">J-{j.job.number}</td>
							<td class="py-1">{j.job.summary || j.jobTypeName || '—'}</td>
							<td class="py-1">{j.technicianName ?? '—'}</td>
							<td class="py-1 text-right capitalize">{j.job.status.replace('_', ' ')}</td>
						</tr>
					{:else}
						<tr><td colspan="5" class="py-2 text-neutral-500">No visits on record.</td></tr>
					{/each}
				</tbody>
			</table>
		</div>

		{#if c.equipment.length}
			<div class="mt-4 break-inside-avoid text-sm">
				<p class="font-semibold tracking-wide text-neutral-500 uppercase">Equipment on file</p>
				<ul class="mt-1 space-y-0.5">
					{#each c.equipment as e (e.equipment.id)}
						<li>
							{e.equipment.name || [e.equipment.brand, e.equipment.model].filter(Boolean).join(' ')}
							{#if e.equipment.serial}· s/n {e.equipment.serial}{/if}
							{#if e.equipment.warrantyUntil}· warranty to {e.equipment.warrantyUntil}{/if}
							{#if e.serviceCount}· {e.serviceCount} visit{e.serviceCount === 1 ? '' : 's'}{/if}
							{#if !e.equipment.active}· retired{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		<p class="mt-6 text-center text-xs text-neutral-400">
			{settings.orgName} · printed {localDate(new Date(), tz)}
		</p>
	</div>
</div>
