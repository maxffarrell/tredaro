<script lang="ts">
	import PageHeader from '#lib/components/app/page-header.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import MoneyInput from '#lib/components/app/money-input.svelte';
	import { toast } from 'svelte-sonner';
	import {
		getInventory,
		createInventoryItem,
		updateInventoryItem,
		adjustInventoryQty,
		deleteInventoryItem
	} from '#lib/remote/inventory.remote.ts';
	import { getCurrency } from '#lib/remote/billing.remote.ts';
	import { errMsg, formatMoney } from '#lib/format.ts';
	import Plus from '@lucide/svelte/icons/plus';
	import Package from '@lucide/svelte/icons/package';
	import Search from '@lucide/svelte/icons/search';
	import Minus from '@lucide/svelte/icons/minus';
	import ArrowUpDown from '@lucide/svelte/icons/arrow-up-down';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	const currency = await getCurrency();
	let rows = $state(await getInventory());
	let q = $state('');
	const items = $derived(
		rows.filter(
			(r) =>
				!q ||
				r.item.name.toLowerCase().includes(q.toLowerCase()) ||
				r.item.sku.toLowerCase().includes(q.toLowerCase())
		)
	);

	// ------- item dialog -------
	let open = $state(false);
	let itemId = $state<string | null>(null);
	let pending = $state(false);
	let name = $state('');
	let sku = $state('');
	let unit = $state('each');
	let qtyOnHand = $state(0);
	let reorderPoint = $state<number | null>(null);
	let unitCost = $state<number | null>(0);
	let notes = $state('');

	function openItem(i?: (typeof rows)[number]) {
		itemId = i?.item.id ?? null;
		name = i?.item.name ?? '';
		sku = i?.item.sku ?? '';
		unit = i?.item.unit ?? 'each';
		qtyOnHand = i?.item.qtyOnHand ?? 0;
		reorderPoint = i?.item.reorderPoint ?? null;
		unitCost = i?.item.unitCost ?? 0;
		notes = i?.item.notes ?? '';
		open = true;
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			const input = { name, sku, unit, qtyOnHand, reorderPoint, unitCost: unitCost ?? 0, notes };
			if (itemId) await updateInventoryItem({ id: itemId, ...input }).updates(getInventory);
			else await createInventoryItem(input).updates(getInventory);
			toast.success('Item saved');
			open = false;
			rows = await getInventory();
		} catch (err) {
			toast.error(errMsg(err, 'Could not save item'));
		}
		pending = false;
	}

	// ------- adjust -------
	let adjusting: (typeof rows)[number] | null = $state(null);
	let adjQty = $state(1);
	async function adjust(direction: 'in' | 'out') {
		if (!adjusting) return;
		try {
			await adjustInventoryQty({ id: adjusting.item.id, delta: adjQty, direction }).updates(
				getInventory
			);
			toast.success(`Stock ${direction === 'in' ? 'added' : 'removed'}`);
			adjusting = null;
			adjQty = 1;
			rows = await getInventory();
		} catch (err) {
			toast.error(errMsg(err, 'Could not adjust stock'));
		}
	}

	async function removeItem(i: (typeof rows)[number]) {
		try {
			await deleteInventoryItem(i.item.id).updates(getInventory);
			toast.success('Item deleted');
			rows = await getInventory();
		} catch (err) {
			toast.error(errMsg(err, 'Could not delete item'));
		}
	}
</script>

<PageHeader title="Inventory">
	{#snippet actions()}
		<Button size="sm" onclick={() => openItem()}><Plus /> New item</Button>
	{/snippet}
</PageHeader>

<div class="space-y-4 p-4 md:p-6">
	<div class="relative max-w-sm">
		<Search class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
		<Input placeholder="Search name or SKU…" class="pl-9" bind:value={q} />
	</div>

	<Card.Root class="py-0">
		<Card.Content class="px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Item</Table.Head>
						<Table.Head class="hidden md:table-cell">SKU</Table.Head>
						<Table.Head class="text-right">On hand</Table.Head>
						<Table.Head class="hidden text-right md:table-cell">Reorder at</Table.Head>
						<Table.Head class="hidden text-right md:table-cell">Unit cost</Table.Head>
						<Table.Head class="w-28 text-right">Stock</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each items as i (i.item.id)}
						<Table.Row class="cursor-pointer" onclick={() => openItem(i)}>
							<Table.Cell class="font-medium">
								{i.item.name}
								{#if i.low}
									<StatusBadge status="overdue" class="ml-2" />
								{/if}
							</Table.Cell>
							<Table.Cell class="hidden text-muted-foreground md:table-cell"
								>{i.item.sku || '—'}</Table.Cell
							>
							<Table.Cell class="text-right tabular-nums"
								>{i.item.qtyOnHand} {i.item.unit}</Table.Cell
							>
							<Table.Cell class="hidden text-right text-muted-foreground tabular-nums md:table-cell"
								>{i.item.reorderPoint ?? '—'}</Table.Cell
							>
							<Table.Cell class="hidden text-right tabular-nums md:table-cell"
								>{i.item.unitCost ? formatMoney(i.item.unitCost, currency) : '—'}</Table.Cell
							>
							<Table.Cell class="text-right" onclick={(e: MouseEvent) => e.stopPropagation()}>
								<div class="flex justify-end gap-1">
									<Button
										variant="ghost"
										size="icon"
										class="size-7"
										title="Adjust stock"
										onclick={() => ((adjusting = i), (adjQty = 1))}
									>
										<ArrowUpDown class="size-3.5" />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										class="size-7 text-muted-foreground"
										title="Delete"
										onclick={() => removeItem(i)}
									>
										<Trash2 class="size-3.5" />
									</Button>
								</div>
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell colspan={6}>
								<Empty.Root class="border-0">
									<Empty.Header>
										<Empty.Media><Package /></Empty.Media>
										<Empty.Title>No stock yet</Empty.Title>
										<Empty.Description
											>Track parts and materials — they can be logged on jobs and alert here when
											they run low.</Empty.Description
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
			<Dialog.Title>{itemId ? 'Edit' : 'New'} inventory item</Dialog.Title>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={save}>
			<Field.Field>
				<Field.Label for="inv-name">Name</Field.Label>
				<Input id="inv-name" required bind:value={name} />
			</Field.Field>
			<div class="grid grid-cols-2 gap-4">
				<Field.Field>
					<Field.Label for="inv-sku">SKU</Field.Label>
					<Input id="inv-sku" bind:value={sku} />
				</Field.Field>
				<Field.Field>
					<Field.Label for="inv-unit">Unit</Field.Label>
					<Input id="inv-unit" bind:value={unit} placeholder="each" />
				</Field.Field>
			</div>
			<div class="grid grid-cols-3 gap-4">
				<Field.Field>
					<Field.Label for="inv-qty">On hand</Field.Label>
					<Input id="inv-qty" type="number" min={0} bind:value={qtyOnHand} />
				</Field.Field>
				<Field.Field>
					<Field.Label for="inv-reorder">Reorder at</Field.Label>
					<Input id="inv-reorder" type="number" min={0} bind:value={reorderPoint} />
				</Field.Field>
				<Field.Field>
					<Field.Label>Unit cost</Field.Label>
					<MoneyInput bind:value={unitCost} />
				</Field.Field>
			</div>
			<Field.Field>
				<Field.Label for="inv-notes">Notes</Field.Label>
				<Textarea id="inv-notes" rows={2} bind:value={notes} />
			</Field.Field>
			<Dialog.Footer>
				<Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root
	open={adjusting != null}
	onOpenChange={(o) => {
		if (!o) adjusting = null;
	}}
>
	<Dialog.Content class="sm:max-w-xs">
		<Dialog.Header>
			<Dialog.Title>Adjust stock · {adjusting?.item.name}</Dialog.Title>
		</Dialog.Header>
		<Field.Field>
			<Field.Label for="adj-qty">Quantity ({adjusting?.item.unit})</Field.Label>
			<Input id="adj-qty" type="number" min={1} bind:value={adjQty} />
		</Field.Field>
		<Dialog.Footer class="gap-2 sm:justify-between">
			<Button variant="outline" onclick={() => adjust('out')} disabled={adjQty < 1}
				><Minus /> Remove</Button
			>
			<Button onclick={() => adjust('in')} disabled={adjQty < 1}><Plus /> Add</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
