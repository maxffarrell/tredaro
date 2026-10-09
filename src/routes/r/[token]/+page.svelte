<script lang="ts">
	import { page } from '$app/state';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import Logo from '#lib/components/app/logo.svelte';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Printer from '@lucide/svelte/icons/printer';
	import { formatDate, formatMoney } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const {
		job,
		customerName,
		techName,
		typeName,
		location: loc,
		orgName,
		orgLogoUrl,
		currency,
		checklist,
		materials,
		photos
	} = $derived(data);
	const token = $derived(page.params.token!);
	const address = $derived(
		loc
			? [loc.address1, [loc.city, loc.state].filter(Boolean).join(', '), loc.zip]
					.filter(Boolean)
					.join(', ')
			: ''
	);
	const phaseLabel = (p: string | null) =>
		p === 'before' ? 'Before' : p === 'during' ? 'During' : p === 'after' ? 'After' : '';
</script>

<svelte:head>
	<title>Service report J-{job.number} — {orgName}</title>
</svelte:head>

<div class="min-h-svh bg-muted/30">
	<header class="border-b bg-background print:hidden">
		<div class="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
			{#if orgLogoUrl}
				<img src={orgLogoUrl} alt={orgName} class="h-8 object-contain" />
			{:else}
				<Logo />
			{/if}
			<span class="truncate font-semibold">{orgName}</span>
		</div>
	</header>

	<main class="mx-auto max-w-3xl space-y-6 p-4 py-8">
		<div class="flex items-start justify-between gap-3">
			<div>
				<h1 class="text-2xl font-semibold tracking-tight">Service report</h1>
				<p class="text-sm text-muted-foreground">
					{typeName ?? (job.summary || 'Service visit')} · J-{job.number} · {formatDate(
						job.completedAt ?? job.startsAt
					)}
				</p>
			</div>
			<Button variant="outline" size="sm" class="print:hidden" onclick={() => window.print()}
				><Printer /> Print</Button
			>
		</div>

		<Card.Root>
			<Card.Header><Card.Title class="text-base">Visit details</Card.Title></Card.Header>
			<Card.Content class="space-y-2 px-6 text-sm">
				<div class="flex justify-between gap-4">
					<span class="text-muted-foreground">Customer</span><span>{customerName}</span>
				</div>
				{#if address}
					<div class="flex justify-between gap-4">
						<span class="text-muted-foreground">Location</span>
						<span class="text-right">{address}</span>
					</div>
				{/if}
				{#if techName}
					<div class="flex justify-between gap-4">
						<span class="text-muted-foreground">Technician</span><span>{techName}</span>
					</div>
				{/if}
				{#if job.summary}
					<div class="flex justify-between gap-4">
						<span class="text-muted-foreground">Job</span>
						<span class="text-right">{job.summary}</span>
					</div>
				{/if}
			</Card.Content>
		</Card.Root>

		{#if job.completionNotes}
			<Card.Root>
				<Card.Header><Card.Title class="text-base">Work performed</Card.Title></Card.Header>
				<Card.Content class="px-6 text-sm whitespace-pre-wrap">{job.completionNotes}</Card.Content>
			</Card.Root>
		{/if}

		{#if checklist.length}
			<Card.Root>
				<Card.Header><Card.Title class="text-base">Checklist</Card.Title></Card.Header>
				<Card.Content class="px-6">
					<ul class="space-y-2 text-sm">
						{#each checklist as c (c.id)}
							<li class="flex items-center gap-2">
								<CircleCheck
									class="size-4 shrink-0 {c.done ? 'text-green-600' : 'text-muted-foreground/40'}"
								/>
								<span class={c.done ? '' : 'text-muted-foreground'}>{c.label}</span>
							</li>
						{/each}
					</ul>
				</Card.Content>
			</Card.Root>
		{/if}

		{#if materials.length}
			<Card.Root>
				<Card.Header><Card.Title class="text-base">Materials used</Card.Title></Card.Header>
				<Card.Content class="overflow-x-auto px-0">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head class="pl-6">Item</Table.Head>
								<Table.Head class="text-right">Qty</Table.Head>
								<Table.Head class="pr-6 text-right">Price</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each materials as m (m.name + m.qty)}
								<Table.Row>
									<Table.Cell class="pl-6 font-medium">{m.name}</Table.Cell>
									<Table.Cell class="text-right tabular-nums"
										>{m.qty}{m.unit ? ` ${m.unit}` : ''}</Table.Cell
									>
									<Table.Cell class="pr-6 text-right tabular-nums"
										>{formatMoney(m.qty * m.unitPrice, currency)}</Table.Cell
									>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</Card.Content>
			</Card.Root>
		{/if}

		{#if photos.length}
			<Card.Root>
				<Card.Header><Card.Title class="text-base">Photos</Card.Title></Card.Header>
				<Card.Content class="px-6">
					<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
						{#each photos as p (p.id)}
							<a
								href="/r/{token}/photo/{p.id}"
								target="_blank"
								rel="noreferrer"
								class="group relative overflow-hidden rounded-md border"
							>
								<img
									src="/r/{token}/photo/{p.id}"
									alt={p.fileName}
									class="aspect-square w-full object-cover transition-transform group-hover:scale-105"
								/>
								{#if p.phase}
									<Badge variant="secondary" class="absolute bottom-1 left-1 text-[10px]"
										>{phaseLabel(p.phase)}</Badge
									>
								{/if}
							</a>
						{/each}
					</div>
				</Card.Content>
			</Card.Root>
		{/if}

		{#if job.signature}
			<Card.Root>
				<Card.Header><Card.Title class="text-base">Customer sign-off</Card.Title></Card.Header>
				<Card.Content class="px-6">
					<img src={job.signature} alt="Customer signature" class="h-24 object-contain" />
					<p class="mt-1 text-xs text-muted-foreground">
						Signed by {job.signedName ?? customerName}{job.signedAt
							? ` · ${formatDate(job.signedAt)}`
							: ''}
					</p>
				</Card.Content>
			</Card.Root>
		{/if}

		<p class="text-center text-xs text-muted-foreground">
			Report provided by {orgName} — reference J-{job.number}
		</p>
	</main>
</div>
