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
	import { toast } from 'svelte-sonner';
	import {
		getPricebook,
		createPricebookItem,
		updatePricebookItem,
		getCurrency
	} from '#lib/remote/billing.remote.ts';
	import { errMsg, formatMoney } from '#lib/format.ts';
	import Plus from '@lucide/svelte/icons/plus';
	import BookOpen from '@lucide/svelte/icons/book-open';
	import Search from '@lucide/svelte/icons/search';

	const currency = await getCurrency();
	let q = $state('');
	let items = $state(await getPricebook());
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
	let durationMin = $state<number | null>(null);
	let category = $state('');
	let active = $state(true);

	function openItem(i?: (typeof items)[number]) {
		itemId = i?.id ?? null;
		name = i?.name ?? '';
		kind = i?.kind ?? 'service';
		description = i?.description ?? '';
		price = i?.price ?? 0;
		durationMin = i?.durationMin ?? null;
		category = i?.category ?? '';
		active = i?.active ?? true;
		open = true;
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			const input = { name, kind, description, price, durationMin, category };
			if (itemId) {
				await updatePricebookItem({ id: itemId, ...input, active });
			} else {
				await createPricebookItem(input);
			}
			toast.success('Item saved');
			open = false;
			items = await getPricebook({ q });
		} catch (err) {
			toast.error(errMsg(err, 'Could not save item'));
		}
		pending = false;
	}
</script>

<PageHeader title="Pricebook">
	{#snippet actions()}
		<Button size="sm" onclick={() => openItem()}><Plus /> New item</Button>
	{/snippet}
</PageHeader>

<div class="space-y-4 p-4 md:p-6">
	<div class="relative max-w-sm">
		<Search class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
		<Input placeholder="Search name or category…" class="pl-9" bind:value={q} oninput={search} />
	</div>

	<Card.Root class="py-0">
		<Card.Content class="px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Item</Table.Head>
						<Table.Head class="hidden md:table-cell">Kind</Table.Head>
						<Table.Head class="hidden md:table-cell">Category</Table.Head>
						<Table.Head class="text-right">Price</Table.Head>
						<Table.Head>Status</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each items as i (i.id)}
						<Table.Row class="cursor-pointer" onclick={() => openItem(i)}>
							<Table.Cell class="font-medium">{i.name}</Table.Cell>
							<Table.Cell class="hidden text-muted-foreground md:table-cell">{i.kind}</Table.Cell>
							<Table.Cell class="hidden text-muted-foreground md:table-cell"
								>{i.category || '—'}</Table.Cell
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
			<Field.Field>
				<Field.Label>Unit price</Field.Label>
				<MoneyInput bind:value={price} />
			</Field.Field>
			<Field.Field>
				<Field.Label for="pb-dur">Duration (minutes, optional)</Field.Label>
				<Input id="pb-dur" type="number" min={5} bind:value={durationMin} />
			</Field.Field>
			<Field.Field>
				<Field.Label for="pb-desc">Description</Field.Label>
				<Textarea id="pb-desc" rows={2} bind:value={description} />
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
