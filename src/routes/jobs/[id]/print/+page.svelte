<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '#lib/components/ui/button/index.js';
	import Printer from '@lucide/svelte/icons/printer';
	import { getJob, getJobChecklist, getTechnicians } from '#lib/remote/jobs.remote.ts';
	import { getJobMaterials } from '#lib/remote/inventory.remote.ts';
	import { getSettings } from '#lib/remote/workspace.remote.ts';
	import { formatDate } from '#lib/format.ts';
	import { localTime } from '#lib/tz.ts';

	const id = page.params.id!;
	const j = await getJob(id);
	const checklist = await getJobChecklist(id);
	const materials = await getJobMaterials({ jobId: id });
	const settings = await getSettings();
	const technicians = await getTechnicians();
	const helperName = j.job.helperId
		? (technicians.find((t) => t.id === j.job.helperId)?.name ?? null)
		: null;
	const tz = settings.timezone;
	const fmtTime = (d: string | Date | null | undefined) => (d ? localTime(new Date(d), tz) : '—');
	const address = [j.address1, j.city, j.state, j.zip].filter(Boolean).join(', ');
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
					{#if settings.logoUrl}
						<img src={settings.logoUrl} alt={settings.orgName} class="mb-2 h-12 object-contain" />
					{/if}
					<p class="text-lg font-bold">{settings.orgName}</p>
					{#if settings.address}<p class="text-sm">{settings.address}</p>{/if}
					{#if settings.phone}<p class="text-sm">{settings.phone}</p>{/if}
					{#if settings.licenseNumber}<p class="text-sm">Lic. #{settings.licenseNumber}</p>{/if}
				</div>
				<div class="text-right">
					<h1 class="text-2xl font-bold tracking-tight">Work order</h1>
					<p class="text-lg font-semibold">J-{j.job.number}</p>
					<p class="text-sm capitalize">{j.job.status.replace('_', ' ')}</p>
				</div>
			</div>
		</header>

		<div class="mt-4 grid grid-cols-2 gap-4 text-sm">
			<div>
				<p class="font-semibold tracking-wide text-neutral-500 uppercase">Customer</p>
				<p class="font-medium">
					{j.companyName ? `${j.companyName} — ` : ''}{j.customerName}
				</p>
				{#if j.customerPhone}<p>{j.customerPhone}</p>{/if}
				{#if j.customerEmail}<p>{j.customerEmail}</p>{/if}
				{#if address}
					<p class="mt-1 font-semibold tracking-wide text-neutral-500 uppercase">Location</p>
					<p>{address}</p>
				{/if}
				{#if j.accessNotes}<p class="mt-0.5 italic">Access: {j.accessNotes}</p>{/if}
			</div>
			<div class="text-right">
				<p class="font-semibold tracking-wide text-neutral-500 uppercase">Schedule</p>
				{#if j.job.startsAt}
					<p>{formatDate(j.job.startsAt)} · {fmtTime(j.job.startsAt)}</p>
				{:else}
					<p>Unscheduled</p>
				{/if}
				{#if j.typeDurationMin}<p>{j.typeDurationMin} min estimated</p>{/if}
				<p>{j.jobTypeName ?? 'Service'}{j.job.summary ? ` — ${j.job.summary}` : ''}</p>
				<p>
					Tech: {j.technicianName ?? 'Unassigned'}{#if helperName}
						+ {helperName}{/if}
				</p>
				{#if j.equipmentName}<p>Equipment: {j.equipmentName}</p>{/if}
			</div>
		</div>

		{#if j.job.description}
			<div class="mt-4 text-sm">
				<p class="font-semibold tracking-wide text-neutral-500 uppercase">Scope / notes</p>
				<p class="mt-1 whitespace-pre-wrap">{j.job.description}</p>
			</div>
		{/if}

		{#if checklist.length}
			<div class="mt-5">
				<p class="font-semibold tracking-wide text-neutral-500 uppercase">Checklist</p>
				<ul class="mt-1 space-y-1 text-sm">
					{#each checklist as item (item.id)}
						<li class="flex items-center gap-2">
							<span
								class="inline-block size-4 border border-neutral-500 text-center text-xs leading-4"
								>{item.done ? '✓' : ''}</span
							>
							<span class={item.done ? 'line-through opacity-60' : ''}>{item.label}</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if materials.length}
			<table class="mt-5 w-full text-sm">
				<thead>
					<tr class="border-b text-left">
						<th class="py-1 font-semibold tracking-wide text-neutral-500 uppercase">Material</th>
						<th class="py-1 text-right font-semibold tracking-wide text-neutral-500 uppercase"
							>Qty</th
						>
						<th class="py-1 pl-4 font-semibold tracking-wide text-neutral-500 uppercase">Unit</th>
					</tr>
				</thead>
				<tbody>
					{#each materials as m (m.material.id)}
						<tr class="border-b border-neutral-200">
							<td class="py-1.5">{m.itemName ?? m.material.customName}</td>
							<td class="py-1.5 text-right tabular-nums">{m.material.qty}</td>
							<td class="py-1.5 pl-4">{m.itemUnit ?? ''}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}

		<div class="mt-10 grid grid-cols-2 gap-8 text-sm">
			<div>
				<p class="font-semibold tracking-wide text-neutral-500 uppercase">Technician</p>
				<p class="mt-8 border-b border-neutral-400 pb-1">Signature / date</p>
			</div>
			<div>
				<p class="font-semibold tracking-wide text-neutral-500 uppercase">Customer</p>
				<p class="mt-8 border-b border-neutral-400 pb-1">Signature / date</p>
			</div>
		</div>
	</div>
</div>
