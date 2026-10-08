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
	import * as Select from '#lib/components/ui/select/index.ts';
	import { toast } from 'svelte-sonner';
	import {
		getInventory,
		createInventoryItem,
		updateInventoryItem,
		adjustInventoryQty,
		deleteInventoryItem,
		getPurchaseOrders,
		createPurchaseOrder,
		transitionPurchaseOrder,
		deletePurchaseOrder,
		getTruckStock,
		transferTruckStock,
		getItemHistory
	} from '#lib/remote/inventory.remote.ts';
	import { getTechnicians } from '#lib/remote/jobs.remote.ts';
	import { getCurrency } from '#lib/remote/billing.remote.ts';
	import { errMsg, formatMoney, formatRelative } from '#lib/format.ts';
	import Plus from '@lucide/svelte/icons/plus';
	import Package from '@lucide/svelte/icons/package';
	import Search from '@lucide/svelte/icons/search';
	import Minus from '@lucide/svelte/icons/minus';
	import ArrowUpDown from '@lucide/svelte/icons/arrow-up-down';
	import ShoppingCart from '@lucide/svelte/icons/shopping-cart';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Truck from '@lucide/svelte/icons/truck';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import History from '@lucide/svelte/icons/history';

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

	// ------- item history -------
	let historyItem = $state<(typeof rows)[number] | null>(null);
	const itemHistory = $derived(historyItem ? await getItemHistory(historyItem.item.id) : []);

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

	// ------- truck stock -------
	const techs = $derived(await getTechnicians());
	let truckRows = $state(await getTruckStock());
	let trOpen = $state(false);
	let trPending = $state(false);
	let trItem = $state('');
	let trMember = $state('');
	let trQty = $state(1);
	async function saveTransfer(e: SubmitEvent) {
		e.preventDefault();
		if (!trItem || !trMember) return;
		trPending = true;
		try {
			await transferTruckStock({
				inventoryItemId: trItem,
				memberId: trMember,
				qty: trQty,
				direction: 'to_truck'
			});
			truckRows = await getTruckStock();
			rows = await getInventory();
			trOpen = false;
			trItem = '';
			trMember = '';
			trQty = 1;
			toast.success('Transferred to truck');
		} catch (err) {
			toast.error(errMsg(err, 'Could not transfer'));
		}
		trPending = false;
	}
	async function returnToWarehouse(s: (typeof truckRows)[number]) {
		try {
			await transferTruckStock({
				inventoryItemId: s.stock.inventoryItemId,
				memberId: s.stock.memberId,
				qty: s.stock.qty,
				direction: 'to_warehouse'
			});
			truckRows = await getTruckStock();
			rows = await getInventory();
			toast.success('Returned to warehouse');
		} catch (err) {
			toast.error(errMsg(err, 'Could not return'));
		}
	}

	// ------- purchase orders -------
	let pos = $state(await getPurchaseOrders());
	let poOpen = $state(false);
	let poPending = $state(false);
	let poSupplier = $state('');
	let poExpected = $state('');
	let poNotes = $state('');
	let poLines = $state<{ inventoryItemId: string; qty: number; unitCost: number | null }[]>([
		{ inventoryItemId: '', qty: 1, unitCost: 0 }
	]);

	function openPo(pre?: (typeof rows)[number]) {
		poSupplier = '';
		poExpected = '';
		poNotes = '';
		poLines = pre
			? [
					{
						inventoryItemId: pre.item.id,
						qty: Math.max((pre.item.reorderPoint ?? 0) * 2 - pre.item.qtyOnHand, 1),
						unitCost: pre.item.unitCost
					}
				]
			: [{ inventoryItemId: '', qty: 1, unitCost: 0 }];
		poOpen = true;
	}
	function pickPoItem(i: number, v: string) {
		poLines[i].inventoryItemId = v;
		poLines[i].unitCost = rows.find((r) => r.item.id === v)?.item.unitCost ?? 0;
	}
	async function savePo(e: SubmitEvent) {
		e.preventDefault();
		if (poLines.some((l) => !l.inventoryItemId)) return;
		poPending = true;
		try {
			await createPurchaseOrder({
				supplier: poSupplier,
				expectedOn: poExpected,
				notes: poNotes,
				items: poLines.map((l) => ({
					inventoryItemId: l.inventoryItemId,
					qty: l.qty,
					unitCost: l.unitCost ?? 0
				}))
			}).updates(getPurchaseOrders);
			toast.success('Purchase order created');
			poOpen = false;
			pos = await getPurchaseOrders();
		} catch (err) {
			toast.error(errMsg(err, 'Could not create PO'));
		}
		poPending = false;
	}

	let poView: (typeof pos)[number] | null = $state(null);
	async function transitionPo(id: string, to: 'ordered' | 'received' | 'cancelled') {
		try {
			await transitionPurchaseOrder({ id, to }).updates(getPurchaseOrders, getInventory);
			toast.success(to === 'received' ? 'Stock received' : `PO ${to}`);
			poView = null;
			pos = await getPurchaseOrders();
			rows = await getInventory();
		} catch (err) {
			toast.error(errMsg(err, 'Could not update PO'));
		}
	}
	async function removePo(id: string) {
		try {
			await deletePurchaseOrder(id).updates(getPurchaseOrders);
			toast.success('PO deleted');
			poView = null;
			pos = await getPurchaseOrders();
		} catch (err) {
			toast.error(errMsg(err, 'Could not delete PO'));
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
									{#if i.low}
										<Button
											variant="ghost"
											size="icon"
											class="size-7"
											title="Order stock"
											onclick={() => openPo(i)}
										>
											<ShoppingCart class="size-3.5" />
										</Button>
									{/if}
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
										class="size-7"
										title="Movement history"
										onclick={() => {
											historyItem = i;
											void getItemHistory(i.item.id).refresh();
										}}
									>
										<History class="size-3.5" />
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
	<Card.Root class="py-0">
		<Card.Header class="flex-row items-center justify-between space-y-0">
			<Card.Title class="flex items-center gap-2 text-base"
				><Truck class="size-4" /> Truck stock</Card.Title
			>
			<Button size="sm" variant="outline" onclick={() => (trOpen = true)}
				><Plus /> Transfer to truck</Button
			>
		</Card.Header>
		<Card.Content class="px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Tech</Table.Head>
						<Table.Head>Item</Table.Head>
						<Table.Head class="text-right">Qty</Table.Head>
						<Table.Head class="w-10"></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each truckRows.filter((r) => r.stock.qty > 0) as r (r.stock.id)}
						<Table.Row>
							<Table.Cell class="font-medium">{r.memberName}</Table.Cell>
							<Table.Cell>{r.itemName}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{r.stock.qty} {r.itemUnit}</Table.Cell>
							<Table.Cell class="text-right">
								<Button
									variant="ghost"
									size="icon"
									class="size-7 text-muted-foreground"
									title="Return all to warehouse"
									onclick={() => returnToWarehouse(r)}><Undo2 class="size-3.5" /></Button
								>
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell colspan={4} class="text-center text-muted-foreground">
								No stock loaded on trucks — transfer warehouse items to a tech.
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>
	<Card.Root class="py-0">
		<Card.Header class="flex-row items-center justify-between space-y-0">
			<Card.Title class="text-base">Purchase orders</Card.Title>
			<Button size="sm" variant="outline" onclick={() => openPo()}><Plus /> New PO</Button>
		</Card.Header>
		<Card.Content class="px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>PO</Table.Head>
						<Table.Head>Supplier</Table.Head>
						<Table.Head class="hidden md:table-cell">Expected</Table.Head>
						<Table.Head class="hidden md:table-cell">Lines</Table.Head>
						<Table.Head class="text-right">Total</Table.Head>
						<Table.Head>Status</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each pos as p (p.po.id)}
						<Table.Row class="cursor-pointer" onclick={() => (poView = p)}>
							<Table.Cell class="font-medium">PO-{p.po.number}</Table.Cell>
							<Table.Cell>{p.po.supplier}</Table.Cell>
							<Table.Cell class="hidden text-muted-foreground md:table-cell"
								>{p.po.expectedOn ?? '—'}</Table.Cell
							>
							<Table.Cell class="hidden text-muted-foreground md:table-cell"
								>{p.items.length} item{p.items.length > 1 ? 's' : ''}</Table.Cell
							>
							<Table.Cell class="text-right tabular-nums"
								>{formatMoney(p.total, currency)}</Table.Cell
							>
							<Table.Cell><StatusBadge status={p.po.status} /></Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell colspan={6} class="text-center text-muted-foreground">
								No purchase orders yet — create one for items running low.
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

<!-- new purchase order -->
<Dialog.Root bind:open={poOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>New purchase order</Dialog.Title>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={savePo}>
			<div class="grid grid-cols-2 gap-4">
				<Field.Field>
					<Field.Label for="po-supplier">Supplier</Field.Label>
					<Input id="po-supplier" required bind:value={poSupplier} placeholder="Johnstone Supply" />
				</Field.Field>
				<Field.Field>
					<Field.Label for="po-expected">Expected</Field.Label>
					<Input id="po-expected" type="date" bind:value={poExpected} />
				</Field.Field>
			</div>
			<div class="space-y-2">
				<p class="text-sm font-medium">Lines</p>
				{#each poLines as l, i (i)}
					<div class="grid grid-cols-[1fr_5rem_7rem_2rem] items-center gap-2">
						<Select.Root
							type="single"
							value={l.inventoryItemId}
							onValueChange={(v: string) => pickPoItem(i, v)}
						>
							<Select.Trigger class="w-full">
								{rows.find((r) => r.item.id === l.inventoryItemId)?.item.name ?? 'Pick an item…'}
							</Select.Trigger>
							<Select.Content>
								{#each rows as r (r.item.id)}
									<Select.Item value={r.item.id}
										>{r.item.name}
										<span class="text-muted-foreground">({r.item.qtyOnHand} {r.item.unit})</span
										></Select.Item
									>
								{/each}
							</Select.Content>
						</Select.Root>
						<Input
							type="number"
							min={1}
							placeholder="Qty"
							aria-label="Quantity"
							bind:value={l.qty}
						/>
						<MoneyInput bind:value={l.unitCost} />
						<Button
							variant="ghost"
							size="icon"
							class="size-8 text-muted-foreground"
							disabled={poLines.length === 1}
							onclick={() => poLines.splice(i, 1)}
						>
							<Trash2 class="size-3.5" />
						</Button>
					</div>
				{/each}
				<Button
					type="button"
					size="sm"
					variant="ghost"
					onclick={() => poLines.push({ inventoryItemId: '', qty: 1, unitCost: 0 })}
				>
					<Plus /> Add line
				</Button>
			</div>
			<Field.Field>
				<Field.Label for="po-notes">Notes</Field.Label>
				<Input id="po-notes" bind:value={poNotes} placeholder="Optional" />
			</Field.Field>
			<Dialog.Footer>
				<Button type="submit" disabled={poPending || poLines.some((l) => !l.inventoryItemId)}
					>{poPending ? 'Saving…' : 'Create PO'}</Button
				>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<!-- purchase order detail -->
<Dialog.Root
	open={poView != null}
	onOpenChange={(o) => {
		if (!o) poView = null;
	}}
>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				PO-{poView?.po.number} · {poView?.po.supplier}
				<StatusBadge status={poView?.po.status ?? 'draft'} />
			</Dialog.Title>
			<Dialog.Description>
				{#if poView?.po.expectedOn}Expected {poView.po.expectedOn} ·
				{/if}
				Total {formatMoney(poView?.total ?? 0, currency)}
				{#if poView?.po.notes}<br />{poView.po.notes}{/if}
			</Dialog.Description>
		</Dialog.Header>
		<Table.Root>
			<Table.Body>
				{#each poView?.items ?? [] as i (i.id)}
					<Table.Row>
						<Table.Cell class="font-medium">{i.name}</Table.Cell>
						<Table.Cell class="text-right tabular-nums">{i.qty} {i.unit}</Table.Cell>
						<Table.Cell class="text-right tabular-nums"
							>{i.unitCost ? formatMoney(i.qty * i.unitCost, currency) : '—'}</Table.Cell
						>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
		{#if poView}
			<Dialog.Footer class="gap-2 sm:justify-between">
				{#if poView.po.status === 'draft'}
					<Button variant="ghost" class="text-destructive" onclick={() => removePo(poView!.po.id)}
						><Trash2 /> Delete</Button
					>
					<div class="flex gap-2">
						<Button variant="outline" onclick={() => transitionPo(poView!.po.id, 'cancelled')}
							>Cancel</Button
						>
						<Button onclick={() => transitionPo(poView!.po.id, 'ordered')}>Mark ordered</Button>
					</div>
				{:else if poView.po.status === 'ordered'}
					<Button variant="outline" onclick={() => transitionPo(poView!.po.id, 'cancelled')}
						>Cancel PO</Button
					>
					<Button onclick={() => transitionPo(poView!.po.id, 'received')}
						><ClipboardList /> Receive stock</Button
					>
				{:else}
					<span></span>
				{/if}
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<!-- transfer to truck -->
<Dialog.Root bind:open={trOpen}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header><Dialog.Title>Transfer to truck</Dialog.Title></Dialog.Header>
		<form class="space-y-4" onsubmit={saveTransfer}>
			<Field.Field>
				<Field.Label>Item</Field.Label>
				<Select.Root type="single" bind:value={trItem}>
					<Select.Trigger class="w-full"
						>{rows.find((r) => r.item.id === trItem)?.item.name ?? 'Pick an item…'}</Select.Trigger
					>
					<Select.Content>
						{#each rows as r (r.item.id)}
							<Select.Item value={r.item.id}
								>{r.item.name}
								<span class="text-muted-foreground">({r.item.qtyOnHand} {r.item.unit})</span
								></Select.Item
							>
						{/each}
					</Select.Content>
				</Select.Root>
			</Field.Field>
			<Field.Field>
				<Field.Label>Technician</Field.Label>
				<Select.Root type="single" bind:value={trMember}>
					<Select.Trigger class="w-full"
						>{techs.find((t) => t.id === trMember)?.name ?? 'Pick a tech…'}</Select.Trigger
					>
					<Select.Content>
						{#each techs as t (t.id)}
							<Select.Item value={t.id}>{t.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</Field.Field>
			<Field.Field>
				<Field.Label for="tr-qty">Quantity</Field.Label>
				<Input id="tr-qty" type="number" min={1} bind:value={trQty} />
			</Field.Field>
			<Dialog.Footer>
				<Button type="submit" disabled={trPending || !trItem || !trMember || trQty < 1}
					>{trPending ? 'Transferring…' : 'Transfer'}</Button
				>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<!-- movement history -->
<Dialog.Root open={!!historyItem} onOpenChange={(o: boolean) => !o && (historyItem = null)}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{historyItem?.item.name} — history</Dialog.Title>
			<Dialog.Description>Every stock movement and edit, newest first.</Dialog.Description>
		</Dialog.Header>
		<div class="max-h-96 divide-y overflow-y-auto">
			{#each itemHistory as e (e.activity.id)}
				<div class="flex items-baseline justify-between gap-3 py-2">
					<div class="text-sm">
						{e.activity.summary}
						{#if e.actorName}
							<span class="text-muted-foreground">· {e.actorName}</span>
						{/if}
					</div>
					<span class="shrink-0 text-xs text-muted-foreground"
						>{formatRelative(e.activity.createdAt)}</span
					>
				</div>
			{:else}
				<p class="py-6 text-center text-sm text-muted-foreground">No movements yet.</p>
			{/each}
		</div>
	</Dialog.Content>
</Dialog.Root>
