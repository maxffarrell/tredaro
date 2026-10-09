<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '#lib/components/ui/button/index.js';
	import Printer from '@lucide/svelte/icons/printer';
	import { getJob, getJobChecklist, getJobPhotos } from '#lib/remote/jobs.remote.ts';
	import { getJobMaterials } from '#lib/remote/inventory.remote.ts';
	import { getSettings } from '#lib/remote/workspace.remote.ts';
	import { formatMoney } from '#lib/format.ts';
	import { localDate, localTime } from '#lib/tz.ts';

	const id = page.params.id!;
	const j = await getJob(id);
	const checklist = await getJobChecklist(id);
	const materials = await getJobMaterials({ jobId: id });
	const photos = await getJobPhotos(id);
	const settings = await getSettings();

	const addr = [j.locationLabel ? `${j.locationLabel}:` : '', j.address1, j.city, j.state]
		.filter(Boolean)
		.join(' ');
	const when = j.job.startsAt
		? `${localDate(j.job.startsAt, settings.timezone)} ${localTime(j.job.startsAt, settings.timezone)}${j.job.arrivalWindow ? ` (arrival ${j.job.arrivalWindow})` : ''}`
		: 'Unscheduled';
</script>

<svelte:head><title>Work order J-{j.job.number}</title></svelte:head>

<div class="min-h-screen bg-white text-neutral-900">
	<div class="mx-auto max-w-3xl p-6 print:p-0">
		<div class="flex items-start justify-between print:hidden">
			<Button variant="outline" onclick={() => history.back()}>Back</Button>
			<Button onclick={() => window.print()}><Printer /> Print</Button>
		</div>

		<header class="mt-4 border-b-2 border-neutral-800 pb-4 print:mt-0">
			<div class="flex items-start justify-between">
				<div>
					<p class="text-lg font-bold">{settings.orgName}</p>
					{#if settings.address}<p class="text-sm">{settings.address}</p>{/if}
					{#if settings.phone}<p class="text-sm">{settings.phone}</p>{/if}
				</div>
				<div class="text-right">
					<h1 class="text-2xl font-bold tracking-tight">Work order</h1>
					<p class="text-lg font-semibold">J-{j.job.number}</p>
				</div>
			</div>
		</header>

		<div class="mt-4 grid grid-cols-2 gap-4 text-sm">
			<div>
				<p class="font-semibold tracking-wide text-neutral-500 uppercase">Customer</p>
				<p class="font-medium">
					{j.companyName ? `${j.companyName} — ` : ''}{j.customerName}
				</p>
				{#if addr}<p>{addr}</p>{/if}
				{#if j.accessNotes}
					<p class="mt-1 font-medium">Access: {j.accessNotes}</p>
				{/if}
			</div>
			<div>
				<p class="font-semibold tracking-wide text-neutral-500 uppercase">Schedule</p>
				<p>{when}</p>
				<p>Technician: {j.technicianName ?? 'Unassigned'}</p>
				{#if j.jobTypeName}<p>Type: {j.jobTypeName}</p>{/if}
				{#if j.job.priority !== 'normal'}<p>Priority: {j.job.priority}</p>{/if}
			</div>
		</div>

		<div class="mt-4 rounded border p-3 text-sm">
			<p class="font-semibold tracking-wide text-neutral-500 uppercase">Scope of work</p>
			<p class="mt-1 font-medium">{j.job.summary}</p>
			{#if j.job.description}<p class="mt-1 whitespace-pre-wrap">{j.job.description}</p>{/if}
			{#if j.equipmentName}<p class="mt-1">Equipment: {j.equipmentName}</p>{/if}
		</div>

		{#if checklist.length}
			<div class="mt-4 text-sm">
				<p class="font-semibold tracking-wide text-neutral-500 uppercase">Checklist</p>
				<ul class="mt-1 space-y-1">
					{#each checklist as item (item.id)}
						<li class="flex items-center gap-2">
							<span
								class="inline-flex size-4 items-center justify-center rounded-sm border border-neutral-500 text-[10px]"
								>{#if item.done}✓{/if}</span
							>
							<span class:line-through={item.done} class:text-neutral-400={item.done}
								>{item.label}</span
							>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if materials.length}
			<div class="mt-4 text-sm">
				<p class="font-semibold tracking-wide text-neutral-500 uppercase">Materials used</p>
				<table class="mt-1 w-full">
					<thead>
						<tr class="border-b text-left"
							><th class="py-1">Item</th><th class="w-16 py-1 text-right">Qty</th><th
								class="w-24 py-1 text-right">Amount</th
							></tr
						>
					</thead>
					<tbody>
						{#each materials as m (m.material.id)}
							<tr class="border-b border-neutral-200">
								<td class="py-1">{m.itemName}</td>
								<td class="py-1 text-right">{m.material.qty} {m.itemUnit}</td>
								<td class="py-1 text-right tabular-nums"
									>{formatMoney(m.material.qty * m.material.unitPrice, settings.currency)}</td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		{#if photos.length}
			<div class="mt-4 text-sm">
				<p class="font-semibold tracking-wide text-neutral-500 uppercase">Photos</p>
				<div class="mt-1 grid grid-cols-3 gap-2">
					{#each photos as p (p.id)}
						<div class="overflow-hidden rounded border">
							<img
								src="/files/job-photo/{p.id}"
								alt={p.fileName}
								class="h-28 w-full object-cover"
							/>
							<p class="truncate px-1 py-0.5 text-xs text-neutral-500">{p.fileName}</p>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		{#if j.job.completionNotes}
			<div class="mt-8">
				<p class="font-semibold tracking-wide text-neutral-500 uppercase">Work performed</p>
				<p class="mt-1 text-sm whitespace-pre-wrap">{j.job.completionNotes}</p>
			</div>
		{/if}

		<div class="mt-8 grid grid-cols-2 gap-8 text-sm">
			<div>
				<p class="font-semibold tracking-wide text-neutral-500 uppercase">Technician notes</p>
				<div class="mt-1 h-20 rounded border"></div>
			</div>
			<div>
				<p class="font-semibold tracking-wide text-neutral-500 uppercase">Customer sign-off</p>
				{#if j.job.signedAt}
					<img src={j.job.signature} alt="Customer signature" class="mt-1 h-16" />
					<p class="mt-1">
						Signed by {j.job.signedName} on {localDate(j.job.signedAt, settings.timezone)}
					</p>
				{:else}
					<p class="mt-6 border-b border-neutral-400 pb-1">Signature</p>
					<p class="mt-4 border-b border-neutral-400 pb-1">Printed name / date</p>
				{/if}
			</div>
		</div>

		<p class="mt-8 text-center text-xs text-neutral-500">
			Generated by {settings.orgName} — J-{j.job.number}
		</p>
	</div>
</div>
