<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import PageHeader from '#lib/components/app/page-header.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import MoneyInput from '#lib/components/app/money-input.svelte';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import { toast } from 'svelte-sonner';
	import {
		getEstimate,
		getEstimates,
		updateEstimate,
		sendEstimate,
		resendEstimate,
		reviseEstimate,
		duplicateEstimate,
		approveEstimateStaff,
		declineEstimateStaff,
		invoiceEstimate
	} from '#lib/remote/estimates.remote.ts';
	import { getSettings } from '#lib/remote/workspace.remote.ts';
	import { errMsg, formatDate, formatMoney } from '#lib/format.ts';
	import Send from '@lucide/svelte/icons/send';
	import Mail from '@lucide/svelte/icons/mail';
	import Receipt from '@lucide/svelte/icons/receipt';
	import Printer from '@lucide/svelte/icons/printer';
	import CopyPlus from '@lucide/svelte/icons/copy-plus';
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';
	import Link2 from '@lucide/svelte/icons/link-2';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import FilePen from '@lucide/svelte/icons/file-pen';
	import Eye from '@lucide/svelte/icons/eye';

	const id = $derived(page.params.id!);
	const est = $derived(await getEstimate(id));
	const settings = await getSettings();
	const currency = settings.currency;

	const draft = $derived(est.estimate.status === 'draft');
	const linkedJob = $derived(est.linkedJob ?? null);

	let notes = $state('');
	let validUntil = $state('');
	let items = $state<
		{
			pricebookItemId: string | null;
			name: string;
			qty: number;
			unitPrice: number;
			optional: boolean;
		}[]
	>([]);
	let loadedId = '';
	$effect(() => {
		if (est.estimate.id !== loadedId) {
			loadedId = est.estimate.id;
			notes = est.estimate.notes;
			validUntil = est.estimate.validUntil ?? '';
			items = est.items.map((i) => ({
				pricebookItemId: i.item.pricebookItemId,
				name: i.item.name,
				qty: i.item.qty,
				unitPrice: i.item.unitPrice,
				optional: i.item.optional
			}));
		}
	});
	let pending = $state(false);
	const totalCents = $derived(items.reduce((s, i) => s + i.qty * i.unitPrice, 0));

	async function save(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			await updateEstimate({
				id,
				notes,
				validUntil: validUntil || null,
				items: items
					.filter((i) => i.name.trim())
					.map((i) => ({
						pricebookItemId: i.pricebookItemId,
						name: i.name,
						qty: i.qty,
						unitPrice: i.unitPrice,
						optional: i.optional
					}))
			}).updates(getEstimate, getEstimates);
			toast.success('Estimate saved');
		} catch (err) {
			toast.error(errMsg(err, 'Could not save'));
		}
		pending = false;
	}

	let sending = $state(false);
	let shareUrl = $derived(est.token ? `${page.url.origin}/e/${est.token}` : '');

	async function send() {
		sending = true;
		try {
			const r = await sendEstimate(id).updates(getEstimate, getEstimates);
			shareUrl = r!.url;
			await navigator.clipboard.writeText(r!.url);
			toast.success('Estimate sent — share link copied');
		} catch (err) {
			toast.error(errMsg(err, 'Could not send'));
		}
		sending = false;
	}

	let resending = $state(false);
	async function resend() {
		resending = true;
		try {
			const r = await resendEstimate(id).updates(getEstimate, getEstimates);
			if (r?.url) await navigator.clipboard.writeText(r.url);
			toast.success('Reminder sent — link copied');
		} catch (err) {
			toast.error(errMsg(err, 'Could not resend'));
		}
		resending = false;
	}

	async function revise() {
		try {
			const rev = await reviseEstimate(id).updates(getEstimate, getEstimates);
			toast.success(`Revision v${rev!.version} created as a draft`);
			goto(`/estimates/${rev!.id}`);
		} catch (err) {
			toast.error(errMsg(err, 'Could not revise'));
		}
	}

	async function invoice() {
		try {
			const inv = await invoiceEstimate(id).updates(getEstimate, getEstimates);
			toast.success(`Draft invoice INV-${inv!.number} created`);
			goto('/billing');
		} catch (err) {
			toast.error(errMsg(err, 'Could not create invoice'));
		}
	}

	async function decide(approve: boolean) {
		try {
			await (approve ? approveEstimateStaff(id) : declineEstimateStaff(id)).updates(
				getEstimate,
				getEstimates
			);
			toast.success(approve ? 'Estimate approved (recorded by staff)' : 'Estimate declined');
		} catch (err) {
			toast.error(errMsg(err, 'Could not record decision'));
		}
	}

	async function duplicate() {
		try {
			const copy = await duplicateEstimate(id).updates(getEstimates);
			toast.success(`Draft E-${copy!.number} created`);
			goto(`/estimates/${copy!.id}`);
		} catch (err) {
			toast.error(errMsg(err, 'Could not duplicate'));
		}
	}

	async function copyLink() {
		await navigator.clipboard.writeText(shareUrl);
		toast.success('Link copied');
	}
</script>

<PageHeader title="E-{est.estimate.number}" crumbs={[{ label: 'Estimates', href: '/estimates' }]}>
	{#snippet actions()}
		<StatusBadge status={est.estimate.status} />
		{#if est.viewedAt}<Badge variant="secondary" title="Customer opened this estimate"
				><Eye /> Viewed</Badge
			>{/if}
		{#if est.estimate.status === 'sent' && est.estimate.validUntil}
			{@const daysLeft = Math.ceil(
				(new Date(`${est.estimate.validUntil}T00:00:00Z`).getTime() - Date.now()) / 86400_000
			)}
			<Badge
				variant="secondary"
				class={daysLeft <= 7
					? 'border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-500'
					: ''}
				title="Public link stops accepting answers after this date"
				>{daysLeft > 0 ? `Expires in ${daysLeft}d` : 'Expires today'}</Badge
			>
		{/if}
		{#if est.estimate.version > 1}<Badge variant="secondary">v{est.estimate.version}</Badge>{/if}
		{#if draft}
			<Button size="sm" onclick={send} disabled={sending}
				><Send /> {sending ? 'Sending…' : 'Send'}</Button
			>
		{:else if shareUrl}
			<Button size="sm" variant="outline" onclick={copyLink}><Link2 /> Copy link</Button>
		{/if}
		{#if est.estimate.status === 'sent'}
			<Button size="sm" variant="outline" onclick={resend} disabled={resending}
				><Mail /> {resending ? 'Resending…' : 'Resend'}</Button
			>
			<Button size="sm" variant="outline" onclick={() => decide(true)}><Check /> Approve</Button>
			<Button size="sm" variant="outline" onclick={() => decide(false)}><X /> Decline</Button>
		{/if}
		{#if est.estimate.status === 'sent' || est.estimate.status === 'declined' || est.estimate.status === 'expired'}
			<Button size="sm" variant="outline" onclick={revise}><FilePen /> Revise</Button>
		{/if}
		{#if est.estimate.status === 'approved' || est.estimate.status === 'converted'}
			<Button size="sm" variant="outline" onclick={invoice}><Receipt /> Invoice</Button>
		{/if}
		<Button size="sm" variant="outline" onclick={duplicate}><CopyPlus /> Duplicate</Button>
		<Button size="sm" variant="outline" href="/estimates/{id}/print"><Printer /> Print</Button>
	{/snippet}
</PageHeader>

<div class="grid gap-6 p-4 md:p-6 lg:grid-cols-3">
	<Card.Root class="lg:col-span-2">
		<Card.Header><Card.Title class="text-base">Items</Card.Title></Card.Header>
		<Card.Content>
			{#if draft}
				<form class="space-y-4" onsubmit={save}>
					{#each items as item, i (i)}
						<div class="grid grid-cols-[1fr_70px_120px_64px_24px_32px] items-center gap-2">
							<Input placeholder="Description" bind:value={item.name} />
							<Input type="number" min={0.01} step={0.01} max={9999} bind:value={item.qty} />
							<MoneyInput bind:value={item.unitPrice} />
							<label
								class="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground select-none"
								title="Customer can include or skip this line on the approval page"
							>
								<Checkbox bind:checked={item.optional} /> Opt
							</label>
							<div class="flex flex-col">
								<Button
									variant="ghost"
									size="icon"
									class="size-4"
									disabled={i === 0}
									onclick={() => {
										const [it] = items.splice(i, 1);
										items.splice(i - 1, 0, it);
										items = items;
									}}><ChevronUp class="size-3" /></Button
								>
								<Button
									variant="ghost"
									size="icon"
									class="size-4"
									disabled={i === items.length - 1}
									onclick={() => {
										const [it] = items.splice(i, 1);
										items.splice(i + 1, 0, it);
										items = items;
									}}><ChevronDown class="size-3" /></Button
								>
							</div>
							<Button
								variant="ghost"
								size="icon"
								class="size-8"
								disabled={items.length === 1}
								onclick={() => items.splice(i, 1) && (items = items)}
								><Trash2 class="size-4" /></Button
							>
						</div>
					{/each}
					<div class="flex items-center justify-between">
						<Button
							variant="outline"
							size="sm"
							onclick={() =>
								(items = [
									...items,
									{ pricebookItemId: null, name: '', qty: 1, unitPrice: 0, optional: false }
								])}><Plus /> Add item</Button
						>
						<span class="font-medium tabular-nums">Total {formatMoney(totalCents, currency)}</span>
					</div>
					<Field.Field>
						<Field.Label for="ed-notes">Notes</Field.Label>
						<Textarea id="ed-notes" rows={3} bind:value={notes} />
					</Field.Field>
					<Field.Field>
						<Field.Label for="ed-valid">Valid until</Field.Label>
						<Input id="ed-valid" type="date" bind:value={validUntil} />
						<Field.Description
							>Defaults to the workspace validity window (Settings → Invoicing).</Field.Description
						>
					</Field.Field>
					<Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button>
				</form>
			{:else}
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Item</Table.Head>
							<Table.Head class="w-16 text-right">Qty</Table.Head>
							<Table.Head class="w-28 text-right">Unit</Table.Head>
							<Table.Head class="w-28 text-right">Amount</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each est.items as i (i.item.id)}
							<Table.Row>
								<Table.Cell
									>{i.item.name}{#if i.item.optional}<Badge
											variant="secondary"
											class="mx-1 font-normal">Optional</Badge
										>{/if}<span class="text-muted-foreground">
										{i.item.description}</span
									></Table.Cell
								>
								<Table.Cell class="text-right">{i.item.qty}</Table.Cell>
								<Table.Cell class="text-right tabular-nums"
									>{formatMoney(i.item.unitPrice, currency)}</Table.Cell
								>
								<Table.Cell class="text-right tabular-nums"
									>{formatMoney(i.item.qty * i.item.unitPrice, currency)}</Table.Cell
								>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
				<Separator class="my-3" />
				<div class="flex justify-end text-sm font-medium tabular-nums">
					Total {formatMoney(
						est.items.reduce((s, i) => s + i.item.qty * i.item.unitPrice, 0),
						currency
					)}
				</div>
				{#if est.estimate.notes}<p class="mt-3 text-sm text-muted-foreground">
						{est.estimate.notes}
					</p>{/if}
			{/if}
		</Card.Content>
	</Card.Root>

	<div class="space-y-6">
		<Card.Root>
			<Card.Header><Card.Title class="text-base">Status</Card.Title></Card.Header>
			<Card.Content class="space-y-2 px-4 text-sm">
				<div class="flex justify-between">
					<span class="text-muted-foreground">Customer</span>
					<a href="/customers/{est.estimate.customerId}" class="font-medium hover:underline"
						>{est.customer.name}</a
					>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Status</span><StatusBadge
						status={est.estimate.status}
					/>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Created</span><span
						>{formatDate(est.estimate.createdAt)}</span
					>
				</div>
				{#if est.estimate.sentAt}
					<div class="flex justify-between">
						<span class="text-muted-foreground">Sent</span><span
							>{formatDate(est.estimate.sentAt)}</span
						>
					</div>
				{/if}
				{#if est.estimate.validUntil}
					<div class="flex justify-between">
						<span class="text-muted-foreground">Valid until</span><span
							>{formatDate(est.estimate.validUntil)}</span
						>
					</div>
				{/if}
				{#if est.estimate.respondedAt}
					<div class="flex justify-between">
						<span class="text-muted-foreground">Decided</span><span
							>{formatDate(est.estimate.respondedAt)}</span
						>
					</div>
					<div class="flex justify-between">
						<span class="text-muted-foreground">By</span><span
							>{est.estimate.decisionName || '—'}</span
						>
					</div>
					{#if est.estimate.decisionNote}
						<div class="flex justify-between gap-4">
							<span class="text-muted-foreground">Note</span><span
								class="text-right text-muted-foreground">{est.estimate.decisionNote}</span
							>
						</div>
					{/if}
				{/if}
				{#if linkedJob}
					<Separator />
					<div class="flex items-center justify-between">
						<span class="text-muted-foreground">Job</span>
						<a href="/jobs/{linkedJob.id}" class="flex items-center gap-1 hover:underline"
							><CircleCheck class="size-4 text-emerald-600" /> J-{linkedJob.number}</a
						>
					</div>
				{/if}
			</Card.Content>
		</Card.Root>
	</div>
</div>
