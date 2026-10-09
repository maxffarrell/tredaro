<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import Printer from '@lucide/svelte/icons/printer';
	import { getMyDay } from '#lib/remote/jobs.remote.ts';
	import { getSettings } from '#lib/remote/workspace.remote.ts';
	import { localDate, localTime } from '#lib/tz.ts';

	const day = await getMyDay();
	const settings = await getSettings();
	const tz = day.tz;

	const jobs = day.jobs
		.slice()
		.sort(
			(a, b) =>
				(a.job.routeOrder ?? Number.MAX_SAFE_INTEGER) -
					(b.job.routeOrder ?? Number.MAX_SAFE_INTEGER) ||
				(a.job.startsAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
					(b.job.startsAt?.getTime() ?? Number.MAX_SAFE_INTEGER)
		);
	const todayLabel = new Date(`${day.today}T12:00:00Z`).toLocaleDateString('en-US', {
		weekday: 'long',
		month: 'long',
		day: 'numeric',
		timeZone: 'UTC'
	});
	const addr = (j: (typeof jobs)[number]) =>
		[j.locationLabel ? `${j.locationLabel}:` : '', j.address1, j.city, j.state]
			.filter(Boolean)
			.join(' ');
</script>

<svelte:head><title>Route sheet — {day.today}</title></svelte:head>

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
				</div>
				<div class="text-right">
					<h1 class="text-2xl font-bold tracking-tight">Route sheet</h1>
					<p class="text-lg font-semibold">{todayLabel}</p>
					<p class="text-sm">{day.member?.name ?? 'Technician'}</p>
				</div>
			</div>
		</header>

		{#each jobs as j, i (j.job.id)}
			<div class="mt-4 break-inside-avoid rounded border p-3 text-sm">
				<div class="flex items-start justify-between gap-3">
					<div class="min-w-0">
						<p class="font-semibold">
							#{i + 1} · J-{j.job.number} — {j.companyName
								? `${j.companyName} — `
								: ''}{j.customerName}
						</p>
						<p class="text-neutral-600">
							{j.job.startsAt
								? `${localTime(j.job.startsAt, tz)}${j.job.endsAt ? `–${localTime(j.job.endsAt, tz)}` : ''}${j.job.arrivalWindow ? ` (arrival ${j.job.arrivalWindow})` : ''}`
								: 'No start time'}
							{#if j.jobTypeName}· {j.jobTypeName}{/if}
						</p>
					</div>
					{#if j.job.priority !== 'normal'}<p class="font-medium">{j.job.priority}</p>{/if}
				</div>
				{#if addr(j)}<p class="mt-1">{addr(j)}</p>{/if}
				<div class="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-neutral-600">
					{#if j.customerPhone}<p>{j.customerPhone}</p>{/if}
					{#if j.job.preferredTime}<p>Prefers {j.job.preferredTime}</p>{/if}
					{#if j.checklistTotal}<p>Checklist {j.checklistDone}/{j.checklistTotal}</p>{/if}
				</div>
				{#if j.accessNotes}<p class="mt-1 font-medium">Access: {j.accessNotes}</p>{/if}
				{#if j.job.summary}<p class="mt-1">{j.job.summary}</p>{/if}
				{#if j.job.description}
					<p class="mt-0.5 whitespace-pre-wrap text-neutral-600">{j.job.description}</p>
				{/if}
			</div>
		{:else}
			<p class="mt-6 text-center text-sm text-neutral-500">Nothing scheduled today.</p>
		{/each}

		{#if day.materials.length}
			<div class="mt-4 break-inside-avoid text-sm">
				<p class="font-semibold tracking-wide text-neutral-500 uppercase">Pull list — materials</p>
				<table class="mt-1 w-full">
					<thead>
						<tr class="border-b text-left"
							><th class="py-1">Item</th><th class="py-1">SKU</th><th class="w-20 py-1 text-right"
								>Qty</th
							></tr
						>
					</thead>
					<tbody>
						{#each day.materials as m (m.name + (m.sku ?? ''))}
							<tr class="border-b border-neutral-200">
								<td class="py-1">{m.name}</td>
								<td class="py-1 text-neutral-600">{m.sku ?? '—'}</td>
								<td class="py-1 text-right tabular-nums">{m.qty} {m.unit}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		{#if day.overdue.length}
			<div class="mt-4 break-inside-avoid text-sm">
				<p class="font-semibold tracking-wide text-neutral-500 uppercase">
					Overdue — still open from earlier
				</p>
				<ul class="mt-1 space-y-0.5">
					{#each day.overdue as j (j.job.id)}
						<li>
							J-{j.job.number} · {j.customerName} — scheduled {j.job.startsAt
								? localDate(j.job.startsAt, tz)
								: '—'}
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
