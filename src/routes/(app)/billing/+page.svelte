<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { SvelteMap, SvelteURLSearchParams } from 'svelte/reactivity';
	import PageHeader from '#lib/components/app/page-header.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import MoneyInput from '#lib/components/app/money-input.svelte';
	import { toast } from 'svelte-sonner';
	import {
		getInvoices,
		createInvoice,
		updateInvoice,
		getCharges,
		addCharge,
		updateCharge,
		getPayments,
		recordPayment,
		getCurrency,
		getInvoicePrefill,
		emailInvoice,
		textInvoice,
		refundPayment
	} from '#lib/remote/billing.remote.ts';
	import { getCustomers } from '#lib/remote/customers.remote.ts';
	import { getJobs } from '#lib/remote/jobs.remote.ts';
	import { getDashboard, getSettings } from '#lib/remote/workspace.remote.ts';
	import { getAiStatus, aiInvoiceSuggestions } from '#lib/remote/ai.remote.ts';
	import { errMsg, formatDate, formatMoney } from '#lib/format.ts';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Ban from '@lucide/svelte/icons/ban';
	import Send from '@lucide/svelte/icons/send';
	import Mail from '@lucide/svelte/icons/mail';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Download from '@lucide/svelte/icons/download';
	import { Spinner } from '#lib/components/ui/spinner/index.js';

	const currency = await getCurrency();
	const todayStr = new Date().toISOString().slice(0, 10);
	const weekStr = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
	const customers = await getCustomers();
	const termsDays = (await getSettings()).invoiceTermsDays;
	const jobs = await getJobs();
	const ai = await getAiStatus();
	const doneJobs = $derived(jobs.filter((j) => j.job.status === 'done'));

	let tab = $state<'invoices' | 'charges' | 'payments'>(
		page.url.searchParams.has('customer') ? 'charges' : 'invoices'
	);
	const customerFilter = $state(page.url.searchParams.get('customer') ?? '');

	let statusParam = $state(page.url.searchParams.get('status') ?? '');
	function setStatus(s: string) {
		statusParam = s;
		const p = new SvelteURLSearchParams();
		if (s) p.set('status', s);
		if (customerFilter) p.set('customer', customerFilter);
		goto(p.size ? `/billing?${p}` : '/billing');
	}
	const invoices = $derived(await getInvoices({ status: statusParam }));
	const charges = $derived(await getCharges({ status: 'open' }));
	const visibleCharges = $derived(
		charges.filter((ch) => !customerFilter || ch.charge.customerId === customerFilter)
	);
	const payments = $derived(await getPayments());
	let payMethodFilter = $state('');
	const topMethod = $derived.by(() => {
		const sums = new SvelteMap<string, number>();
		for (const p of visiblePayments)
			sums.set(p.payment.method, (sums.get(p.payment.method) ?? 0) + p.payment.amount);
		const top = [...sums.entries()].sort((a, b) => b[1] - a[1])[0];
		return sums.size > 1 && top ? top : null;
	});
	const payMethods = $derived([...new Set(payments.map((p) => p.payment.method))].sort());
	const visiblePayments = $derived(
		payments.filter(
			(p) =>
				(!customerFilter || p.payment.customerId === customerFilter) &&
				(!payMethodFilter || p.payment.method === payMethodFilter)
		)
	);
	const visiblePaymentsToday = $derived(
		visiblePayments.filter(
			(p) => new Date(p.payment.paidAt).toISOString().slice(0, 10) === todayStr
		).length
	);
	const visiblePaymentsTotal = $derived(
		visiblePayments.reduce((sum, p) => sum + p.payment.amount, 0)
	);

	// ------- invoice dialog -------
	let invoiceOpen = $state(false);
	let invoicePending = $state(false);
	let invCustomerId = $state('');
	let invJobId = $state('');
	let invDueDate = $state('');
	let invItems = $state<{ name: string; qty: number; unitPrice: number; description?: string }[]>(
		[]
	);
	let prefillLoading = $state(false);

	async function openInvoice() {
		invoiceOpen = true;
		invItems = [{ name: '', qty: 1, unitPrice: 0 }];
	}

	let aiLoading = $state(false);
	async function suggestItems() {
		if (!invJobId || aiLoading) return;
		aiLoading = true;
		try {
			const { items } = await aiInvoiceSuggestions(invJobId);
			if (!items.length) toast('No suggestions — the job may need more notes');
			else {
				invItems = [...invItems.filter((i) => i.name.trim()), ...items];
				toast.success(`${items.length} item${items.length === 1 ? '' : 's'} suggested`);
			}
		} catch (err) {
			toast.error(errMsg(err, 'AI suggestion failed'));
		}
		aiLoading = false;
	}

	async function prefill(jobId: string) {
		if (!jobId) return;
		prefillLoading = true;
		try {
			const p = await getInvoicePrefill(jobId);
			if (p) {
				invCustomerId = p.job.customerId;
				invJobId = jobId;
				invItems = p.items.map((i) => ({
					name: i.name,
					qty: i.qty,
					unitPrice: i.unitPrice,
					description: i.description
				}));
			}
		} catch (err) {
			toast.error(errMsg(err, 'Could not prefill'));
		}
		prefillLoading = false;
	}

	const invoiceForJob = page.url.searchParams.get('invoiceFor');
	if (invoiceForJob) {
		openInvoice();
		prefill(invoiceForJob);
	}

	const invTotal = $derived(invItems.reduce((s, i) => s + i.qty * i.unitPrice, 0));

	async function submitInvoice(e: SubmitEvent) {
		e.preventDefault();
		invoicePending = true;
		try {
			await createInvoice({
				customerId: invCustomerId,
				jobId: invJobId || null,
				dueDate:
					invDueDate || new Date(Date.now() + termsDays * 86400_000).toISOString().slice(0, 10),
				items: invItems
					.filter((i) => i.name.trim())
					.map((i) => ({
						name: i.name,
						qty: i.qty,
						unitPrice: i.unitPrice,
						description: i.description
					}))
			}).updates(getInvoices, getCharges, getPayments, getDashboard);
			toast.success('Invoice issued');
			invoiceOpen = false;
		} catch (err) {
			toast.error(errMsg(err, 'Could not create invoice'));
		}
		invoicePending = false;
	}

	async function sendInvoice(id: string) {
		try {
			const { sent } = await emailInvoice(id);
			if (sent) toast.success('Invoice emailed');
			else toast.error('Already emailed, or the customer has no email');
		} catch (err) {
			toast.error(errMsg(err, 'Could not email invoice'));
		}
	}

	let bulkSending = $state(false);
	const openUnpaid = $derived(
		invoices.filter((i) => i.invoice.status === 'open' && i.total > 0 && i.total - i.paid > 0)
	);

	async function emailAllOpen() {
		bulkSending = true;
		let sent = 0;
		let skipped = 0;
		for (const inv of openUnpaid) {
			try {
				const { sent: ok } = await emailInvoice(inv.invoice.id);
				if (ok) sent++;
				else skipped++;
			} catch {
				skipped++;
			}
		}
		bulkSending = false;
		if (sent) toast.success(`Emailed ${sent} invoice${sent === 1 ? '' : 's'}`);
		if (skipped) toast.error(`${skipped} couldn't be emailed (no email or already sent)`);
	}

	async function refundPaymentCmd(id: string) {
		try {
			await refundPayment(id).updates(getPayments, getCharges, getInvoices, getDashboard);
			toast.success('Payment refunded');
		} catch (err) {
			toast.error(errMsg(err, 'Could not refund'));
		}
	}

	async function textInvoiceCmd(id: string) {
		try {
			const { sent } = await textInvoice(id);
			if (sent) toast.success('Invoice texted');
			else toast.error('Already texted, SMS off, or the customer has no phone');
		} catch (err) {
			toast.error(errMsg(err, 'Could not text invoice'));
		}
	}

	async function voidInvoice(id: string) {
		try {
			await updateInvoice({ id, status: 'void' }).updates(getInvoices, getCharges, getDashboard);
			toast.success('Invoice voided');
		} catch (err) {
			toast.error(errMsg(err, 'Could not void'));
		}
	}

	// ------- charge dialog -------
	let chargeOpen = $state(false);
	let chargePending = $state(false);
	let chCustomerId = $state(customerFilter || '');
	let chDesc = $state('');
	let chCents = $state(0);
	let chDue = $state('');

	async function submitCharge(e: SubmitEvent) {
		e.preventDefault();
		chargePending = true;
		try {
			await addCharge({
				customerId: chCustomerId,
				description: chDesc,
				amount: chCents,
				dueDate: chDue || new Date(Date.now() + termsDays * 86400_000).toISOString().slice(0, 10)
			}).updates(getCharges, getDashboard);
			toast.success('Charge posted');
			chargeOpen = false;
			chDesc = '';
			chCents = 0;
		} catch (err) {
			toast.error(errMsg(err, 'Could not post charge'));
		}
		chargePending = false;
	}

	async function voidCharge(id: string) {
		try {
			await updateCharge({ id, status: 'void' }).updates(getCharges, getDashboard);
			toast.success('Charge voided');
		} catch (err) {
			toast.error(errMsg(err, 'Could not void'));
		}
	}

	// ------- payment dialog -------
	let payOpen = $state(false);
	let payPending = $state(false);
	let payCustomerId = $state(customerFilter || '');
	let payDollars = $state('');
	let payMethod = $state<'cash' | 'card' | 'bank' | 'other'>('card');
	let payNote = $state('');
	let payReference = $state('');
	const payCents = $derived(Math.round((parseFloat(payDollars) || 0) * 100));

	async function submitPayment(e: SubmitEvent) {
		e.preventDefault();
		payPending = true;
		try {
			await recordPayment({
				customerId: payCustomerId,
				amount: payCents,
				method: payMethod,
				reference: payReference || undefined,
				notes: payNote
			}).updates(getPayments, getCharges, getInvoices, getDashboard);
			toast.success('Payment recorded');
			payOpen = false;
			payDollars = payNote = payReference = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not record payment'));
		}
		payPending = false;
	}
</script>

<PageHeader title="Billing">
	{#snippet actions()}
		<Button
			size="sm"
			variant="outline"
			onclick={() => {
				chCustomerId = customerFilter;
				chargeOpen = true;
			}}><Plus /> Post charge</Button
		>
		<Button size="sm" variant="outline" onclick={() => (payOpen = true)}>Record payment</Button>
		<Button
			size="sm"
			variant="outline"
			disabled={bulkSending || openUnpaid.length === 0}
			onclick={emailAllOpen}
			title="Email every open, unpaid invoice to its customer"
			><Mail /> Email open ({openUnpaid.length})</Button
		>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button size="sm" variant="outline" {...props}><Download /> Export</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end" class="w-52">
				<DropdownMenu.Item onclick={() => (window.location.href = '/api/export/invoices.csv')}
					>Invoices (CSV)</DropdownMenu.Item
				>
				<DropdownMenu.Item onclick={() => (window.location.href = '/api/export/quickbooks.csv')}
					>QuickBooks invoices</DropdownMenu.Item
				>
				<DropdownMenu.Item onclick={() => (window.location.href = '/api/export/xero.csv')}
					>Xero invoices</DropdownMenu.Item
				>
				<DropdownMenu.Item onclick={() => (window.location.href = '/api/export/payments.csv')}
					>Payments (CSV)</DropdownMenu.Item
				>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
		<Button size="sm" onclick={openInvoice}><Plus /> New invoice</Button>
	{/snippet}
</PageHeader>

<div class="space-y-4 p-4 md:p-6">
	{#if customerFilter}
		<p class="text-sm">
			Filtered to <a href="/customers/{customerFilter}" class="font-medium hover:underline"
				>{customers.find((x) => x.id === customerFilter)?.name ?? 'customer'}</a
			>
			·
			<button class="text-muted-foreground underline" onclick={() => goto('/billing')}>clear</button
			>
		</p>
	{/if}

	<Tabs.Root bind:value={tab}>
		<Tabs.List>
			<Tabs.Trigger value="invoices">Invoices</Tabs.Trigger>
			<Tabs.Trigger value="charges">Open charges</Tabs.Trigger>
			<Tabs.Trigger value="payments">Payments</Tabs.Trigger>
		</Tabs.List>

		<Tabs.Content value="invoices">
			{@const openRows = invoices.filter(
				(i) => i.invoice.status === 'open' && i.total - i.paid > 0
			)}
			{#if openRows.length}
				<p class="mb-2 text-sm text-muted-foreground">
					Open receivables: <span class="font-medium text-foreground"
						>{formatMoney(
							openRows.reduce((sum, i) => sum + i.total - i.paid, 0),
							currency
						)}</span
					>
					across {openRows.length} invoice{openRows.length === 1 ? '' : 's'} · avg
					{formatMoney(
						openRows.reduce((sum, i) => sum + i.total - i.paid, 0) / openRows.length,
						currency
					)}
					· avg
					{Math.round(
						openRows.reduce(
							(sum, i) => sum + (Date.now() - new Date(i.invoice.createdAt).getTime()) / 86400_000,
							0
						) / openRows.length
					)}d open{#if weekStr && openRows.filter((i) => i.invoice.dueDate && i.invoice.dueDate >= todayStr && i.invoice.dueDate <= weekStr).length}
						· {openRows.filter(
							(i) =>
								i.invoice.dueDate && i.invoice.dueDate >= todayStr && i.invoice.dueDate <= weekStr
						).length} due this week{/if}
				</p>
			{/if}
			{@const voided = invoices.filter((i) => i.invoice.status === 'void')}
			{#if voided.length}
				<p class="mb-2 text-sm text-muted-foreground">
					{voided.length} voided invoice{voided.length === 1 ? '' : 's'} excluded from totals
				</p>
			{/if}
			{#if statusParam === 'overdue' && invoices.length}
				<p class="mb-2 text-sm text-muted-foreground">
					{invoices.length} overdue invoice{invoices.length === 1 ? '' : 's'} ·
					<span class="font-medium text-amber-600 dark:text-amber-400"
						>{formatMoney(
							invoices.reduce((sum, i) => sum + i.total - i.paid, 0),
							currency
						)}</span
					>
				</p>
			{/if}
			<div class="mb-2 flex gap-1.5">
				{#each [['', 'All'], ['open', 'Open'], ['overdue', 'Overdue'], ['void', 'Void']] as [s, label] (s)}
					<Button
						size="sm"
						variant={statusParam === s ? 'default' : 'outline'}
						onclick={() => setStatus(s)}>{label}</Button
					>
				{/each}
			</div>
			<Card.Root class="py-0">
				<Card.Content class="px-0">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Invoice</Table.Head>
								<Table.Head>Customer</Table.Head>
								<Table.Head class="hidden md:table-cell">Issued</Table.Head>
								<Table.Head class="hidden md:table-cell">Due</Table.Head>
								<Table.Head class="text-right">Total</Table.Head>
								<Table.Head class="w-24 text-right">Status</Table.Head>
								<Table.Head class="w-10"></Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each invoices.filter((i) => !customerFilter || i.invoice.customerId === customerFilter) as inv (inv.invoice.id)}
								<Table.Row>
									<Table.Cell class="font-medium">INV-{inv.invoice.number}</Table.Cell>
									<Table.Cell>
										<a href="/customers/{inv.invoice.customerId}" class="hover:underline"
											>{inv.customerName}</a
										>
									</Table.Cell>
									<Table.Cell class="hidden text-muted-foreground md:table-cell"
										>{formatDate(inv.invoice.issuedAt)}</Table.Cell
									>
									<Table.Cell class="hidden text-muted-foreground md:table-cell"
										>{inv.invoice.dueDate ? formatDate(inv.invoice.dueDate) : '—'}
										{#if inv.invoice.status === 'open' && inv.invoice.dueDate && inv.invoice.dueDate < todayStr && inv.total - inv.paid > 0}
											<span class="text-amber-600"
												>({Math.ceil(
													(Date.now() - new Date(inv.invoice.dueDate).getTime()) / 86400000
												)}d)</span
											>
										{/if}</Table.Cell
									>
									<Table.Cell class="text-right tabular-nums"
										>{formatMoney(inv.total - inv.paid, currency)}</Table.Cell
									>
									<Table.Cell class="text-right"
										><StatusBadge
											status={inv.invoice.status === 'open' &&
											inv.total > 0 &&
											inv.total - inv.paid <= 0
												? 'paid'
												: inv.invoice.status === 'open' && inv.paid > 0
													? 'partial'
													: inv.invoice.status}
										/></Table.Cell
									>
									<Table.Cell class="text-right">
										{#if inv.invoice.status === 'open'}
											<Button
												variant="ghost"
												size="icon"
												class="size-8"
												title="Email invoice"
												onclick={(e: MouseEvent) => {
													e.stopPropagation();
													sendInvoice(inv.invoice.id);
												}}><Send class="size-4" /></Button
											>
											<Button
												variant="ghost"
												size="icon"
												class="size-8"
												title="Text invoice link"
												onclick={(e: MouseEvent) => {
													e.stopPropagation();
													textInvoiceCmd(inv.invoice.id);
												}}><MessageSquare class="size-4" /></Button
											>
											<Button
												variant="ghost"
												size="icon"
												class="size-8 text-destructive"
												onclick={(e: MouseEvent) => {
													e.stopPropagation();
													voidInvoice(inv.invoice.id);
												}}><Ban class="size-4" /></Button
											>
										{/if}
									</Table.Cell>
								</Table.Row>
							{:else}
								<Table.Row
									><Table.Cell colspan={7} class="text-center text-muted-foreground"
										>No invoices.</Table.Cell
									></Table.Row
								>
							{/each}
						</Table.Body>
					</Table.Root>
				</Card.Content>
			</Card.Root>
		</Tabs.Content>

		<Tabs.Content value="charges">
			<p class="text-sm text-muted-foreground">
				{visibleCharges.length} open charge{visibleCharges.length === 1 ? '' : 's'} ·
				{formatMoney(
					visibleCharges.reduce((sum, ch) => sum + (ch.charge.amount - ch.paid), 0),
					currency
				)} remaining{#if visibleCharges.filter((ch) => ch.charge.dueDate && ch.charge.dueDate < todayStr && ch.charge.amount - ch.paid > 0).length}
					· <span class="text-amber-600 dark:text-amber-400"
						>{visibleCharges.filter(
							(ch) =>
								ch.charge.dueDate && ch.charge.dueDate < todayStr && ch.charge.amount - ch.paid > 0
						).length} overdue</span
					>{/if}{#if visibleCharges.filter((ch) => ch.paid > 0 && ch.charge.amount - ch.paid > 0).length}
					· {visibleCharges.filter((ch) => ch.paid > 0 && ch.charge.amount - ch.paid > 0).length} partial{/if}{#if visibleCharges.filter((ch) => ch.charge.dueDate && ch.charge.dueDate >= todayStr && ch.charge.dueDate <= weekStr).length}
					· {visibleCharges.filter(
						(ch) =>
							ch.charge.dueDate && ch.charge.dueDate >= todayStr && ch.charge.dueDate <= weekStr
					).length} due this week{/if}{#if visibleCharges.filter((ch) => !ch.charge.dueDate && ch.charge.amount - ch.paid > 0).length}
					· <span class="text-amber-600 dark:text-amber-400"
						>{visibleCharges.filter((ch) => !ch.charge.dueDate && ch.charge.amount - ch.paid > 0)
							.length} no due date</span
					>{/if}{#if visibleCharges.filter((ch) => ch.charge.dueDate === todayStr && ch.charge.amount - ch.paid > 0).length}
					· {visibleCharges.filter(
						(ch) => ch.charge.dueDate === todayStr && ch.charge.amount - ch.paid > 0
					).length} due today{/if}
			</p>
			<Card.Root class="py-0">
				<Card.Content class="px-0">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Charge</Table.Head>
								<Table.Head>Customer</Table.Head>
								<Table.Head class="hidden md:table-cell">Due</Table.Head>
								<Table.Head class="text-right">Remaining</Table.Head>
								<Table.Head class="w-24 text-right">Status</Table.Head>
								<Table.Head class="w-10"></Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each visibleCharges as ch (ch.charge.id)}
								<Table.Row>
									<Table.Cell class="font-medium"
										>{ch.charge.description || `Invoice #${ch.invoiceNumber}`}</Table.Cell
									>
									<Table.Cell
										><a href="/customers/{ch.charge.customerId}" class="hover:underline"
											>{ch.customerName}</a
										></Table.Cell
									>
									<Table.Cell class="hidden text-muted-foreground md:table-cell"
										>{formatDate(ch.charge.dueDate)}</Table.Cell
									>
									<Table.Cell class="text-right tabular-nums"
										>{formatMoney(ch.charge.amount - ch.paid, currency)}</Table.Cell
									>
									<Table.Cell class="text-right"
										><StatusBadge status={ch.charge.status} /></Table.Cell
									>
									<Table.Cell class="text-right">
										{#if ch.charge.status === 'open'}
											<Button
												variant="ghost"
												size="icon"
												class="size-8 text-destructive"
												onclick={() => voidCharge(ch.charge.id)}><Ban class="size-4" /></Button
											>
										{/if}
									</Table.Cell>
								</Table.Row>
							{:else}
								<Table.Row
									><Table.Cell colspan={6} class="text-center text-muted-foreground"
										>No open charges.</Table.Cell
									></Table.Row
								>
							{/each}
						</Table.Body>
					</Table.Root>
				</Card.Content>
			</Card.Root>
		</Tabs.Content>

		<Tabs.Content value="payments">
			{#if payMethods.length > 1}
				<Select.Root
					type="single"
					value={payMethodFilter}
					onValueChange={(v: string) => (payMethodFilter = v)}
				>
					<Select.Trigger class="w-40 capitalize">{payMethodFilter || 'All methods'}</Select.Trigger
					>
					<Select.Content>
						<Select.Item value="">All methods</Select.Item>
						{#each payMethods as m (m)}
							<Select.Item value={m} class="capitalize">{m}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			{/if}
			<p class="text-sm text-muted-foreground">
				{visiblePayments.length} payment{visiblePayments.length === 1 ? '' : 's'} ·
				{formatMoney(visiblePaymentsTotal, currency)} collected{#if visiblePayments.length}
					· avg {formatMoney(
						visiblePaymentsTotal / visiblePayments.length,
						currency
					)}{/if}{#if topMethod}
					· top: <span class="capitalize">{topMethod[0]}</span>
					{formatMoney(topMethod[1], currency)}{/if}{#if visiblePaymentsToday}
					· {visiblePaymentsToday} today{/if}
			</p>
			<Card.Root class="py-0">
				<Card.Content class="px-0">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Customer</Table.Head>
								<Table.Head>Method</Table.Head>
								<Table.Head class="hidden md:table-cell">Received</Table.Head>
								<Table.Head class="hidden md:table-cell">Note</Table.Head>
								<Table.Head class="text-right">Amount</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each visiblePayments as p (p.payment.id)}
								<Table.Row>
									<Table.Cell class="font-medium"
										><a href="/customers/{p.payment.customerId}" class="hover:underline"
											>{p.customerName}</a
										></Table.Cell
									>
									<Table.Cell class="capitalize"
										>{p.payment.method}{#if p.payment.reference}
											<span class="text-muted-foreground">
												· {p.payment.reference}</span
											>{/if}</Table.Cell
									>
									<Table.Cell class="hidden text-muted-foreground md:table-cell"
										>{formatDate(p.payment.paidAt)}</Table.Cell
									>
									<Table.Cell class="hidden text-muted-foreground md:table-cell"
										>{p.payment.notes || '—'}
										{#if p.payment.refundedAt}
											<Badge variant="secondary" class="ml-1">refunded</Badge>
										{/if}</Table.Cell
									>
									<Table.Cell
										class="text-right tabular-nums {p.payment.amount < 0 ? 'text-destructive' : ''}"
										>{formatMoney(p.payment.amount, currency)}</Table.Cell
									>
									<Table.Cell class="text-right">
										{#if p.payment.amount > 0 && !p.payment.refundedAt}
											<Button
												variant="ghost"
												size="icon"
												class="size-8"
												title="Refund payment"
												onclick={(e: MouseEvent) => {
													e.stopPropagation();
													refundPaymentCmd(p.payment.id);
												}}><Undo2 class="size-4" /></Button
											>
										{/if}
									</Table.Cell>
								</Table.Row>
							{:else}
								<Table.Row
									><Table.Cell colspan={6} class="text-center text-muted-foreground"
										>No payments yet.</Table.Cell
									></Table.Row
								>
							{/each}
						</Table.Body>
					</Table.Root>
				</Card.Content>
			</Card.Root>
		</Tabs.Content>
	</Tabs.Root>
</div>

<!-- new invoice -->
<Dialog.Root bind:open={invoiceOpen}>
	<Dialog.Content class="sm:max-w-xl">
		<Dialog.Header>
			<Dialog.Title>New invoice</Dialog.Title>
			<Dialog.Description>Issuing posts one receivable charge for the total.</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={submitInvoice}>
			<div class="grid gap-4 sm:grid-cols-2">
				<Field.Field>
					<Field.Label>From job (optional)</Field.Label>
					<Select.Root
						type="single"
						value={invJobId}
						onValueChange={(v: string) => {
							invJobId = v;
							prefill(v);
						}}
					>
						<Select.Trigger class="w-full"
							>{invJobId
								? `J-${doneJobs.find((j) => j.job.id === invJobId)?.job.number}`
								: 'Pick a completed job'}</Select.Trigger
						>
						<Select.Content>
							{#each doneJobs as j (j.job.id)}
								<Select.Item value={j.job.id}
									>J-{j.job.number} {j.job.summary || j.jobTypeName} — {j.customerName}</Select.Item
								>
							{/each}
						</Select.Content>
					</Select.Root>
					{#if prefillLoading}<Field.Description>Pulling estimate/price…</Field.Description>{/if}
				</Field.Field>
				<Field.Field>
					<Field.Label>Customer</Field.Label>
					<Select.Root type="single" bind:value={invCustomerId}>
						<Select.Trigger class="w-full"
							>{customers.find((c) => c.id === invCustomerId)?.name ?? 'Choose'}</Select.Trigger
						>
						<Select.Content>
							{#each customers as c (c.id)}
								<Select.Item value={c.id}>{c.name}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</Field.Field>
			</div>
			<div class="space-y-2">
				<div class="flex items-center justify-between">
					<p class="text-sm font-medium">Items</p>
					{#if ai.available && invJobId}
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={aiLoading}
							onclick={suggestItems}
						>
							{#if aiLoading}<Spinner class="size-3.5" />{:else}<Sparkles />{/if}
							Suggest items
						</Button>
					{/if}
				</div>
				{#each invItems as item, i (i)}
					<div class="grid grid-cols-[1fr_70px_120px_32px] items-center gap-2">
						<Input placeholder="Description" bind:value={item.name} />
						<Input type="number" min={0.01} step={0.01} max={9999} bind:value={item.qty} />
						<MoneyInput bind:value={item.unitPrice} />
						<Button
							variant="ghost"
							size="icon"
							class="size-8"
							disabled={invItems.length === 1}
							onclick={() => invItems.splice(i, 1) && (invItems = invItems)}
							><Trash2 class="size-4" /></Button
						>
					</div>
				{/each}
				<div class="flex items-center justify-between">
					<Button
						variant="outline"
						size="sm"
						onclick={() => (invItems = [...invItems, { name: '', qty: 1, unitPrice: 0 }])}
						><Plus /> Add item</Button
					>
					<span class="text-sm font-medium tabular-nums">{formatMoney(invTotal, currency)}</span>
				</div>
			</div>
			<Field.Field>
				<Field.Label for="i-due">Due date</Field.Label>
				<Input id="i-due" type="date" bind:value={invDueDate} />
			</Field.Field>
			<Dialog.Footer>
				<Button type="submit" disabled={invoicePending || !invCustomerId}
					>{invoicePending ? 'Issuing…' : 'Issue invoice'}</Button
				>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<!-- post charge -->
<Dialog.Root bind:open={chargeOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Post charge</Dialog.Title>
			<Dialog.Description>One-off receivable against a customer.</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={submitCharge}>
			<Field.Field>
				<Field.Label>Customer</Field.Label>
				<Select.Root type="single" bind:value={chCustomerId}>
					<Select.Trigger class="w-full"
						>{customers.find((c) => c.id === chCustomerId)?.name ?? 'Choose'}</Select.Trigger
					>
					<Select.Content>
						{#each customers as c (c.id)}
							<Select.Item value={c.id}>{c.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</Field.Field>
			<Field.Field>
				<Field.Label for="ch-desc">Description</Field.Label>
				<Input id="ch-desc" bind:value={chDesc} required />
			</Field.Field>
			<Field.Field>
				<Field.Label>Amount</Field.Label>
				<MoneyInput bind:value={chCents} />
			</Field.Field>
			<Field.Field>
				<Field.Label for="ch-due">Due date</Field.Label>
				<Input id="ch-due" type="date" bind:value={chDue} />
			</Field.Field>
			<Dialog.Footer>
				<Button type="submit" disabled={chargePending || !chCustomerId || chCents <= 0}
					>{chargePending ? 'Posting…' : 'Post charge'}</Button
				>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<!-- record payment -->
<Dialog.Root bind:open={payOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Record payment</Dialog.Title>
			<Dialog.Description>Applies to the customer's oldest open charges first.</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={submitPayment}>
			<Field.Field>
				<Field.Label>Customer</Field.Label>
				<Select.Root type="single" bind:value={payCustomerId}>
					<Select.Trigger class="w-full"
						>{customers.find((c) => c.id === payCustomerId)?.name ?? 'Choose'}</Select.Trigger
					>
					<Select.Content>
						{#each customers as c (c.id)}
							<Select.Item value={c.id}>{c.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</Field.Field>
			<Field.Field>
				<Field.Label for="pp-amt">Amount</Field.Label>
				<Input id="pp-amt" type="number" step="0.01" min="0.01" required bind:value={payDollars} />
			</Field.Field>
			<Field.Field>
				<Field.Label>Method</Field.Label>
				<Select.Root type="single" bind:value={payMethod}>
					<Select.Trigger class="w-full">{payMethod}</Select.Trigger>
					<Select.Content>
						{#each ['cash', 'card', 'bank', 'other'] as m (m)}
							<Select.Item value={m}>{m}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</Field.Field>
			<Field.Field>
				<Field.Label for="pp-ref">Reference</Field.Label>
				<Input id="pp-ref" bind:value={payReference} placeholder="Check #, txn id…" />
			</Field.Field>
			<Field.Field>
				<Field.Label for="pp-note">Note</Field.Label>
				<Input id="pp-note" bind:value={payNote} placeholder="Optional" />
			</Field.Field>
			<Dialog.Footer>
				<Button type="submit" disabled={payPending || !payCustomerId || payCents <= 0}
					>{payPending ? 'Saving…' : 'Record payment'}</Button
				>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
