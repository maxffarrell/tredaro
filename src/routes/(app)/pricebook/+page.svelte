<script lang="ts">
	import PageHeader from '#lib/components/app/page-header.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import MoneyInput from '#lib/components/app/money-input.svelte';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { toast } from 'svelte-sonner';
	import {
		getPricebook,
		createPricebookItem,
		updatePricebookItem,
		getCurrency,
		importPricebookItems,
		adjustPricebookPrices
	} from '#lib/remote/billing.remote.ts';
	import { errMsg, formatMoney } from '#lib/format.ts';
	import { getJobTypes } from '#lib/remote/jobs.remote.ts';
	import Plus from '@lucide/svelte/icons/plus';
	import BookOpen from '@lucide/svelte/icons/book-open';
	import Search from '@lucide/svelte/icons/search';
	import Upload from '@lucide/svelte/icons/upload';
	import Download from '@lucide/svelte/icons/download';
	import { parseCsv } from '#lib/csv.ts';
	import { getAiStatus, aiPricebookDraft } from '#lib/remote/ai.remote.ts';
	import Sparkles from '@lucide/svelte/icons/sparkles';

	const ai = await getAiStatus();

	const currency = await getCurrency();
	const jobTypes = $derived(await getJobTypes());
	let q = $state('');
	let items = $state(await getPricebook());
	let catFilter = $state('');
	const categories = $derived([...new Set(items.map((i) => i.category).filter(Boolean))].sort());
	const shown = $derived(catFilter ? items.filter((i) => i.category === catFilter) : items);
	let timer: ReturnType<typeof setTimeout> | undefined;
	function search() {
		clearTimeout(timer);
		timer = setTimeout(async () => (items = await getPricebook({ q })), 150);
	}

	// ------- item dialog -------
	let open = $state(false);
	let itemId = $state<string | null>(null);
	let pending = $state(false);
	let name = $state('');
	let kind = $state<'service' | 'material'>('service');
	let description = $state('');
	let price = $state(0);
	let cost = $state(0);
	let durationMin = $state<number | null>(null);
	let category = $state('');
	let jobTypeId = $state('');
	let active = $state(true);
	let taxable = $state(true);

	function openItem(i?: (typeof items)[number]) {
		itemId = i?.id ?? null;
		name = i?.name ?? '';
		kind = i?.kind ?? 'service';
		description = i?.description ?? '';
		price = i?.price ?? 0;
		cost = i?.cost ?? 0;
		durationMin = i?.durationMin ?? null;
		category = i?.category ?? '';
		jobTypeId = i?.jobTypeId ?? '';
		active = i?.active ?? true;
		taxable = i?.taxable ?? true;
		open = true;
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			const input = {
				name,
				kind,
				description,
				price,
				cost,
				durationMin,
				category,
				jobTypeId: jobTypeId || null,
				taxable
			};
			if (itemId) {
				await updatePricebookItem({ id: itemId, ...input, active }).updates(getPricebook);
			} else {
				await createPricebookItem(input).updates(getPricebook);
			}
			toast.success('Item saved');
			open = false;
			items = await getPricebook({ q });
		} catch (err) {
			toast.error(errMsg(err, 'Could not save item'));
		}
		pending = false;
	}

	// ------- CSV import -------
	let importOpen = $state(false);
	let importText = $state('');
	let importPending = $state(false);
	/** Columns: name, kind, category, price, duration_min, description, cost (header row optional). */
	const importRows = $derived.by(() => {
		let rows = parseCsv(importText).map((r) => ({
			name: r[0]?.trim() ?? '',
			kind: r[1]?.trim().toLowerCase() ?? '',
			category: r[2]?.trim() ?? '',
			price: r[3]?.trim() ?? '',
			durationMin: r[4]?.trim() ?? '',
			description: r[5]?.trim() ?? '',
			cost: r[6]?.trim() ?? ''
		}));
		if (rows.length && rows[0]!.name.toLowerCase() === 'name') rows = rows.slice(1);
		return rows.filter((r) => r.name);
	});
	function onImportFile(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		file?.text().then((t) => (importText = t));
	}
	async function runImport() {
		importPending = true;
		try {
			const r = await importPricebookItems(
				importRows.map((row) => ({
					name: row.name,
					kind: row.kind === 'material' ? 'material' : 'service',
					category: row.category,
					description: row.description,
					price: Number(row.price || 0),
					cost: Number(row.cost || 0),
					durationMin: row.durationMin ? Number(row.durationMin) : null
				}))
			).updates(getPricebook);
			toast.success(
				`Imported ${r.created} item${r.created === 1 ? '' : 's'}${r.skipped ? ` — skipped ${r.skipped} duplicate${r.skipped === 1 ? '' : 's'}` : ''}`
			);
			importOpen = false;
			importText = '';
			items = await getPricebook({ q });
		} catch (err) {
			toast.error(errMsg(err, 'Import failed'));
		}
		importPending = false;
	}

	// ------- AI draft -------
	let aiOpen = $state(false);
	let aiPrompt = $state('');
	let aiPending = $state(false);
	let aiAddPending = $state(false);
	let aiRows = $state<
		{
			name: string;
			kind: 'service' | 'material';
			category: string;
			price: number;
			durationMin: number | null;
		}[]
	>([]);
	async function runAiDraft() {
		aiPending = true;
		try {
			const r = await aiPricebookDraft({ prompt: aiPrompt });
			aiRows = r.items;
			if (!r.items.length) toast.info('Nothing to add — try describing more services');
		} catch (err) {
			toast.error(errMsg(err, 'Could not draft items'));
		}
		aiPending = false;
	}
	async function addAiRows() {
		aiAddPending = true;
		try {
			for (const r of aiRows)
				await createPricebookItem({
					name: r.name,
					kind: r.kind,
					category: r.category,
					price: r.price,
					cost: 0,
					durationMin: r.durationMin,
					description: '',
					jobTypeId: null,
					taxable: true
				});
			toast.success(`Added ${aiRows.length} item${aiRows.length === 1 ? '' : 's'}`);
			aiOpen = false;
			aiRows = [];
			aiPrompt = '';
			items = await getPricebook({ q });
		} catch (err) {
			toast.error(errMsg(err, 'Could not add items'));
		}
		aiAddPending = false;
	}

	let adjustOpen = $state(false);
	let adjustPct = $state(0);
	let adjustCat = $state('');
	let adjustPending = $state(false);

	async function submitAdjust() {
		adjustPending = true;
		try {
			const r = await adjustPricebookPrices({
				pct: adjustPct,
				category: adjustCat || undefined
			}).updates(getPricebook);
			toast.success(`Adjusted ${r.adjusted} item${r.adjusted === 1 ? '' : 's'} by ${adjustPct}%`);
			adjustOpen = false;
			items = await getPricebook({ q });
		} catch (err) {
			toast.error(errMsg(err, 'Could not adjust prices'));
		}
		adjustPending = false;
	}
</script>

<PageHeader title="Pricebook">
	{#snippet actions()}
		{#if ai.available}
			<Button size="sm" variant="outline" onclick={() => (aiOpen = true)}
				><Sparkles /> Draft with AI</Button
			>
		{/if}
		<Button size="sm" variant="outline" onclick={() => (adjustOpen = true)}>Adjust prices</Button>
		<Button size="sm" variant="outline" onclick={() => (importOpen = true)}
			><Upload /> Import</Button
		>
		<Button size="sm" variant="outline" href="/api/export/pricebook.csv" download>
			<Download /> Export
		</Button>
		<Button size="sm" onclick={() => openItem()}><Plus /> New item</Button>
	{/snippet}
</PageHeader>

<div class="space-y-4 p-4 md:p-6">
	<div class="flex flex-wrap items-center gap-2">
		<div class="relative max-w-sm flex-1">
			<Search class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
			<Input placeholder="Search name or category…" class="pl-9" bind:value={q} oninput={search} />
		</div>
		{#if categories.length}
			<Select.Root
				type="single"
				value={catFilter || 'all'}
				onValueChange={(v) => (catFilter = v === 'all' ? '' : v)}
			>
				<Select.Trigger class="w-44">{catFilter || 'All categories'}</Select.Trigger>
				<Select.Content>
					<Select.Item value="all">All categories</Select.Item>
					{#each categories as c (c)}
						<Select.Item value={c}>{c}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		{/if}
	</div>
	{#if shown.length}
		<p class="text-sm text-muted-foreground">
			{shown.length} item{shown.length === 1 ? '' : 's'}
			· {shown.filter((i) => i.kind === 'service').length} services · {shown.filter(
				(i) => i.kind === 'material'
			).length} materials{#if shown.filter((i) => i.active).length}
				· avg {formatMoney(
					shown.filter((i) => i.active).reduce((m, i) => m + i.price, 0) /
						shown.filter((i) => i.active).length,
					currency
				)} (active){/if}
		</p>
	{/if}

	<Card.Root class="py-0">
		<Card.Content class="overflow-x-auto px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Item</Table.Head>
						<Table.Head class="hidden md:table-cell">Kind</Table.Head>
						<Table.Head class="hidden md:table-cell">Category</Table.Head>
						<Table.Head class="hidden text-right md:table-cell">Cost</Table.Head>
						<Table.Head class="text-right">Price</Table.Head>
						<Table.Head>Status</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each shown as i (i.id)}
						<Table.Row class="cursor-pointer" onclick={() => openItem(i)}>
							<Table.Cell class="font-medium"
								>{i.name}{#if i.jobTypeId}
									<span class="text-muted-foreground"
										>· {jobTypes.find((t) => t.id === i.jobTypeId)?.name ?? ''}</span
									>{/if}</Table.Cell
							>
							<Table.Cell class="hidden text-muted-foreground md:table-cell">{i.kind}</Table.Cell>
							<Table.Cell class="hidden text-muted-foreground md:table-cell"
								>{i.category || '—'}</Table.Cell
							>
							<Table.Cell class="hidden text-right text-muted-foreground tabular-nums md:table-cell"
								>{i.cost ? formatMoney(i.cost, currency) : '—'}</Table.Cell
							>
							<Table.Cell class="text-right tabular-nums"
								>{formatMoney(i.price, currency)}</Table.Cell
							>
							<Table.Cell><StatusBadge status={i.active ? 'active' : 'inactive'} /></Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell colspan={5}>
								<Empty.Root class="border-0">
									<Empty.Header>
										<Empty.Media><BookOpen /></Empty.Media>
										<Empty.Title>Empty pricebook</Empty.Title>
										<Empty.Description
											>Add flat-rate services and materials you bill for.</Empty.Description
										>
									</Empty.Header>
									<Empty.Content><Button onclick={() => openItem()}>New item</Button></Empty.Content
									>
								</Empty.Root>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>
</div>

<Dialog.Root bind:open>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{itemId ? 'Edit' : 'New'} pricebook item</Dialog.Title>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={save}>
			<Field.Field>
				<Field.Label for="pb-name">Name</Field.Label>
				<Input id="pb-name" required bind:value={name} />
			</Field.Field>
			<div class="grid grid-cols-2 gap-4">
				<Field.Field>
					<Field.Label>Kind</Field.Label>
					<Select.Root type="single" bind:value={kind}>
						<Select.Trigger class="w-full">{kind}</Select.Trigger>
						<Select.Content>
							<Select.Item value="service">service</Select.Item>
							<Select.Item value="material">material</Select.Item>
						</Select.Content>
					</Select.Root>
				</Field.Field>
				<Field.Field>
					<Field.Label for="pb-cat">Category</Field.Label>
					<Input id="pb-cat" bind:value={category} />
				</Field.Field>
			</div>
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<Field.Field>
					<Field.Label>Unit price</Field.Label>
					<MoneyInput bind:value={price} />
				</Field.Field>
				<Field.Field>
					<Field.Label>Unit cost</Field.Label>
					<MoneyInput bind:value={cost} />
				</Field.Field>
			</div>
			<Field.Field>
				<Field.Label for="pb-dur">Duration (minutes, optional)</Field.Label>
				<Input id="pb-dur" type="number" min={5} bind:value={durationMin} />
			</Field.Field>
			<Field.Field>
				<Field.Label>Job type</Field.Label>
				<Select.Root type="single" bind:value={jobTypeId}>
					<Select.Trigger class="w-full"
						>{jobTypes.find((t) => t.id === jobTypeId)?.name ?? 'None'}</Select.Trigger
					>
					<Select.Content>
						<Select.Item value="">None</Select.Item>
						{#each jobTypes.filter((t) => t.active) as t (t.id)}
							<Select.Item value={t.id}>{t.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				<Field.Description>Suggests this item when quoting that kind of work.</Field.Description>
			</Field.Field>
			<Field.Field>
				<Field.Label for="pb-desc">Description</Field.Label>
				<Textarea id="pb-desc" rows={2} bind:value={description} />
			</Field.Field>
			<Field.Field>
				<label class="flex items-center gap-2 text-sm font-medium">
					<Switch bind:checked={taxable} /> Taxable
				</label>
				<Field.Description
					>Non-taxable items (e.g. labor in some states) are excluded from the sales-tax line on
					invoices.</Field.Description
				>
			</Field.Field>
			{#if itemId}
				<Field.Field>
					<Field.Label>Status</Field.Label>
					<Select.Root
						type="single"
						value={active ? 'yes' : 'no'}
						onValueChange={(v: string) => (active = v === 'yes')}
					>
						<Select.Trigger class="w-full">{active ? 'active' : 'inactive'}</Select.Trigger>
						<Select.Content>
							<Select.Item value="yes">active</Select.Item>
							<Select.Item value="no">inactive</Select.Item>
						</Select.Content>
					</Select.Root>
				</Field.Field>
			{/if}
			<Dialog.Footer>
				<Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={importOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Import pricebook items</Dialog.Title>
			<Dialog.Description>
				Paste CSV or pick a file — columns: name, kind (service|material), category, price,
				duration_min, description, cost (all but name optional; header row optional). Items whose
				name already exists are skipped.
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-3">
			<Input type="file" accept=".csv,text/csv,text/plain" onchange={onImportFile} />
			<Textarea
				rows={6}
				class="font-mono text-xs"
				placeholder="name,kind,category,price,duration_min,description&#10;AC tune-up,service,HVAC,129,60,Seasonal tune-up"
				bind:value={importText}
			/>
			{#if importText.trim()}
				<p class="text-xs text-muted-foreground">
					{importRows.length} item{importRows.length === 1 ? '' : 's'} ready to import
				</p>
			{/if}
		</div>
		<Dialog.Footer>
			<Button disabled={importPending || !importRows.length} onclick={runImport}
				>{importPending ? 'Importing…' : 'Import'}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={adjustOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Adjust prices</Dialog.Title>
			<Dialog.Description>
				Apply a percent change to active items — e.g. 5 for a 5% increase, -10 for a 10% discount.
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-3">
			<Field.Field>
				<Field.Label>Percent change</Field.Label>
				<Field.Content>
					<Input type="number" min={-90} max={500} step={0.5} bind:value={adjustPct} />
				</Field.Content>
			</Field.Field>
			{#if categories.length}
				<Field.Field>
					<Field.Label>Category</Field.Label>
					<Field.Content>
						<Select.Root
							type="single"
							value={adjustCat || 'all'}
							onValueChange={(v) => (adjustCat = v === 'all' ? '' : v)}
						>
							<Select.Trigger class="w-full">
								{adjustCat || 'All categories'}
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="all">All categories</Select.Item>
								{#each categories as c (c)}
									<Select.Item value={c}>{c}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</Field.Content>
				</Field.Field>
			{/if}
		</div>
		<Dialog.Footer>
			<Button disabled={adjustPending || adjustPct === 0} onclick={submitAdjust}
				>{adjustPending ? 'Applying…' : 'Apply'}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- AI draft -->
<Dialog.Root bind:open={aiOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Draft items with AI</Dialog.Title>
			<Dialog.Description>
				Describe the services you offer or paste a vendor price list — the model drafts items
				gaps-first against your catalog.
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-3">
			<Textarea
				rows={5}
				placeholder="e.g. residential HVAC — seasonal tune-ups, capacitor and contactor swaps, refrigerant recharge, blower motor replacement…"
				bind:value={aiPrompt}
			/>
			<Button
				variant="secondary"
				disabled={aiPending || aiPrompt.trim().length < 3}
				onclick={runAiDraft}><Sparkles /> {aiPending ? 'Drafting…' : 'Draft items'}</Button
			>
			{#if aiRows.length}
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Name</Table.Head>
							<Table.Head>Kind</Table.Head>
							<Table.Head>Category</Table.Head>
							<Table.Head class="text-right">Price</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each aiRows as r (r.name)}
							<Table.Row>
								<Table.Cell class="font-medium">{r.name}</Table.Cell>
								<Table.Cell class="capitalize">{r.kind}</Table.Cell>
								<Table.Cell>{r.category}</Table.Cell>
								<Table.Cell class="text-right tabular-nums"
									>{formatMoney(r.price, currency)}{r.durationMin
										? ` · ${r.durationMin}m`
										: ''}</Table.Cell
								>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			{/if}
		</div>
		{#if aiRows.length}
			<Dialog.Footer>
				<Button disabled={aiAddPending} onclick={addAiRows}
					>{aiAddPending
						? 'Adding…'
						: `Add ${aiRows.length} item${aiRows.length === 1 ? '' : 's'}`}</Button
				>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
