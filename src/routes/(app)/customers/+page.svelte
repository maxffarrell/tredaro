<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import PageHeader from '#lib/components/app/page-header.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { toast } from 'svelte-sonner';
	import {
		getCustomers,
		createCustomer,
		importCustomers,
		checkCustomerDuplicates
	} from '#lib/remote/customers.remote.ts';
	import { errMsg, formatDate, formatMoney } from '#lib/format.ts';
	import { parseCsv, toCsv } from '#lib/csv.ts';
	import { getCurrency } from '#lib/remote/billing.remote.ts';
	import Plus from '@lucide/svelte/icons/plus';
	import Users from '@lucide/svelte/icons/users';
	import Search from '@lucide/svelte/icons/search';
	import Download from '@lucide/svelte/icons/download';
	import Upload from '@lucide/svelte/icons/upload';
	import CalendarCheck from '@lucide/svelte/icons/calendar-check';

	const currency = await getCurrency();
	let q = $state('');
	let tagFilter = $state('');
	let officeFilter = $state('');
	let sourceFilter = $state('');
	let statusFilter = $state('active');
	let typeFilter = $state('');
	let customers = $state(await getCustomers());
	const officeOptions = $derived(
		[
			...new Map(
				customers.filter((c) => c.officeName).map((c) => [c.officeId ?? '', c.officeName!])
			).entries()
		].sort((a, b) => a[1].localeCompare(b[1]))
	);
	const allSources = $derived(
		[...new Set(customers.map((c) => c.leadSource).filter((x): x is string => !!x))].sort((a, b) =>
			a.localeCompare(b)
		)
	);
	const allTags = $derived(
		[...new Set(customers.flatMap((c) => c.tags ?? []))].sort((a, b) => a.localeCompare(b))
	);
	const visible = $derived(
		customers.filter(
			(c) =>
				(!tagFilter || c.tags?.includes(tagFilter)) &&
				(!officeFilter || (c.officeId ?? '') === officeFilter) &&
				(!sourceFilter || c.leadSource === sourceFilter) &&
				(!statusFilter || c.status === statusFilter) &&
				(!typeFilter || c.type === typeFilter)
		)
	);
	const totalBalance = $derived(visible.reduce((sum, c) => sum + c.openBalance, 0));
	const onHoldCount = $derived(visible.filter((c) => c.onHold).length);
	const withBalance = $derived(visible.filter((c) => c.openBalance > 0).length);
	const missingEmail = $derived(visible.filter((c) => !c.email).length);
	const missingPhone = $derived(visible.filter((c) => !c.phone).length);
	const withPortal = $derived(visible.filter((c) => c.portalLinked).length);
	const companyCount = $derived(visible.filter((c) => c.companyName).length);
	const residentialCount = $derived(visible.filter((c) => c.type === 'residential').length);
	const withEquipment = $derived(visible.filter((c) => c.hasEquipment).length);
	const underAgreement = $derived(visible.filter((c) => c.hasAgreement).length);

	const withOpenQuote = $derived(visible.filter((c) => c.hasOpenQuote).length);
	const leadOnly = $derived(visible.filter((c) => c.leadSource && !c.lastVisit).length);
	const optedOut = $derived(visible.filter((c) => c.smsOptOut || c.emailOptOut).length);
	const taggedCount = $derived(visible.filter((c) => c.tags?.length).length);
	const withPreferred = $derived(visible.filter((c) => c.preferredMemberId).length);
	const inactiveCount = $derived(visible.filter((c) => c.status !== 'active').length);
	const neverServiced = $derived(
		visible.filter((c) => c.status === 'active' && !c.lastVisit).length
	);
	const noUpcoming = $derived(
		visible.filter((c) => c.status === 'active' && !c.hasUpcoming).length
	);
	const newThisMonth = $derived(
		visible.filter((c) => c.since && c.since >= new Date().toISOString().slice(0, 8) + '01').length
	);
	let timer: ReturnType<typeof setTimeout> | undefined;
	function search() {
		clearTimeout(timer);
		timer = setTimeout(async () => (customers = await getCustomers({ q })), 150);
	}

	let open = $state(page.url.searchParams.get('new') === '1');
	let pending = $state(false);
	let type = $state<'residential' | 'commercial'>('residential');
	let companyName = $state('');
	let name = $state('');
	let email = $state('');
	let phone = $state('');

	// ------- csv import -------
	let importOpen = $state(false);
	let importText = $state('');
	let importPending = $state(false);
	/** Parsed rows — a leading header row (name,email,phone,…) is dropped, blank names skipped. */
	const importRows = $derived.by(() => {
		let rows = parseCsv(importText).map((r) => ({
			name: r[0]?.trim() ?? '',
			email: r[1]?.trim() ?? '',
			phone: r[2]?.trim() ?? ''
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
			const r = await importCustomers(
				importRows.map((row) => ({ name: row.name, email: row.email, phone: row.phone || null }))
			).updates(getCustomers);
			toast.success(
				`Imported ${r.created} customer${r.created === 1 ? '' : 's'}${r.skipped ? ` — skipped ${r.skipped} duplicate${r.skipped === 1 ? '' : 's'}` : ''}`
			);
			importOpen = false;
			importText = '';
			customers = await getCustomers({ q });
		} catch (err) {
			toast.error(errMsg(err, 'Import failed'));
		}
		importPending = false;
	}

	function exportCsv() {
		const csv = toCsv([
			[
				'Name',
				'Company',
				'Email',
				'Phone',
				'Status',
				'Plan',
				'Last visit',
				'Open balance',
				'Since'
			],
			...customers.map((c) => [
				c.name,
				c.companyName,
				c.email,
				c.phone,
				c.status,
				c.planName,
				c.lastVisit ? formatDate(c.lastVisit) : '',
				(c.openBalance / 100).toFixed(2),
				c.since ? formatDate(c.since) : ''
			])
		]);
		const a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
		a.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
		a.click();
		URL.revokeObjectURL(a.href);
	}

	let dupMatches = $state<{ customer: { id: string; name: string }; match: string }[]>([]);
	let dupAcked = $state(false);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			if (!dupAcked) {
				dupMatches = await checkCustomerDuplicates({
					name: name || undefined,
					email: email || undefined,
					phone: phone || undefined
				});
				if (dupMatches.length) {
					dupAcked = true;
					pending = false;
					return;
				}
			}
			await createCustomer({
				type,
				companyName: companyName || undefined,
				name,
				email: email || undefined,
				phone: phone || undefined
			}).updates(getCustomers);
			toast.success('Customer added');
			open = false;
			dupMatches = [];
			dupAcked = false;
			companyName = name = email = phone = '';
			customers = await getCustomers({ q });
		} catch (err) {
			toast.error(errMsg(err, 'Could not add customer'));
		}
		pending = false;
	}
</script>

<PageHeader title="Customers">
	{#snippet actions()}
		<Button size="sm" variant="outline" onclick={() => (importOpen = true)}
			><Upload /> Import</Button
		>
		<Button size="sm" variant="outline" onclick={exportCsv}><Download /> Export</Button>
		<Button size="sm" onclick={() => (open = true)}><Plus /> Add customer</Button>
	{/snippet}
</PageHeader>

<div class="space-y-4 p-4 md:p-6">
	<div class="flex flex-wrap gap-2">
		<div class="relative max-w-sm min-w-56 flex-1">
			<Search class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
			<Input
				placeholder="Search name, company, contact info, equipment…"
				class="pl-9"
				bind:value={q}
				oninput={search}
			/>
		</div>
		{#if allTags.length}
			<Select.Root type="single" value={tagFilter} onValueChange={(v: string) => (tagFilter = v)}>
				<Select.Trigger class="w-40">{tagFilter || 'All tags'}</Select.Trigger>
				<Select.Content>
					<Select.Item value="">All tags</Select.Item>
					{#each allTags as t (t)}
						<Select.Item value={t}>{t}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		{/if}
		{#if officeOptions.length}
			<Select.Root
				type="single"
				value={officeFilter}
				onValueChange={(v: string) => (officeFilter = v)}
			>
				<Select.Trigger class="w-44"
					>{officeOptions.find(([id]) => id === officeFilter)?.[1] ?? 'All offices'}</Select.Trigger
				>
				<Select.Content>
					<Select.Item value="">All offices</Select.Item>
					{#each officeOptions as [id, name] (id)}
						<Select.Item value={id}>{name}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		{/if}
		<Select.Root type="single" value={typeFilter} onValueChange={(v: string) => (typeFilter = v)}>
			<Select.Trigger class="w-36 capitalize">{typeFilter || 'All types'}</Select.Trigger>
			<Select.Content>
				<Select.Item value="">All types</Select.Item>
				{#each ['residential', 'commercial'] as ty (ty)}
					<Select.Item value={ty} class="capitalize">{ty}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
		<Select.Root
			type="single"
			value={statusFilter}
			onValueChange={(v: string) => (statusFilter = v)}
		>
			<Select.Trigger class="w-32 capitalize">{statusFilter || 'All statuses'}</Select.Trigger>
			<Select.Content>
				<Select.Item value="">All statuses</Select.Item>
				{#each ['active', 'inactive'] as st (st)}
					<Select.Item value={st} class="capitalize">{st}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
		{#if allSources.length}
			<Select.Root
				type="single"
				value={sourceFilter}
				onValueChange={(v: string) => (sourceFilter = v)}
			>
				<Select.Trigger class="w-44">{sourceFilter || 'All sources'}</Select.Trigger>
				<Select.Content>
					<Select.Item value="">All sources</Select.Item>
					{#each allSources as src (src)}
						<Select.Item value={src} class="capitalize">{src}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		{/if}
	</div>

	<div class="flex flex-wrap items-center gap-1.5">
		<Badge variant="secondary" class="font-normal"
			>{visible.length} customer{visible.length === 1 ? '' : 's'}</Badge
		>
		<Badge variant="secondary" class="font-normal"
			>{formatMoney(totalBalance, currency)} open balance</Badge
		>
		{#if newThisMonth}<Badge variant="outline" class="font-normal"
				>{newThisMonth} new this month</Badge
			>{/if}
		{#if withBalance}<Badge variant="outline" class="font-normal"
				>{withBalance} with balance (avg {formatMoney(totalBalance / withBalance, currency)})</Badge
			>{/if}
		{#if onHoldCount}<Badge variant="outline" class="font-normal text-red-600 dark:text-red-400"
				>{onHoldCount} on hold</Badge
			>{/if}
		{#if withPortal}<Badge variant="outline" class="font-normal">{withPortal} with portal</Badge
			>{/if}
		{#if missingEmail}<Badge
				variant="outline"
				class="font-normal text-amber-600 dark:text-amber-400">{missingEmail} missing email</Badge
			>{/if}
		{#if missingPhone}<Badge
				variant="outline"
				class="font-normal text-amber-600 dark:text-amber-400">{missingPhone} missing phone</Badge
			>{/if}
		{#if companyCount}<Badge variant="outline" class="font-normal">{companyCount} companies</Badge
			>{/if}
		{#if residentialCount}<Badge variant="outline" class="font-normal"
				>{residentialCount} residential</Badge
			>{/if}
		{#if noUpcoming}<Badge variant="outline" class="font-normal"
				>{noUpcoming} without upcoming visit</Badge
			>{/if}
		{#if underAgreement}<Badge variant="outline" class="font-normal"
				>{underAgreement} under agreement</Badge
			>{/if}
		{#if withEquipment}<Badge variant="outline" class="font-normal"
				>{withEquipment} with equipment</Badge
			>{/if}
		{#if neverServiced}<Badge variant="outline" class="font-normal"
				>{neverServiced} never serviced</Badge
			>{/if}
		{#if withOpenQuote}<Badge variant="outline" class="font-normal"
				>{withOpenQuote} with open quote</Badge
			>{/if}
		{#if leadOnly}<Badge variant="outline" class="font-normal">{leadOnly} lead-only</Badge>{/if}
		{#if inactiveCount}<Badge variant="outline" class="font-normal">{inactiveCount} inactive</Badge
			>{/if}
		{#if taggedCount}<Badge variant="outline" class="font-normal">{taggedCount} tagged</Badge>{/if}
		{#if optedOut}<Badge variant="outline" class="font-normal">{optedOut} opted out</Badge>{/if}
		{#if withPreferred}<Badge variant="outline" class="font-normal"
				>{withPreferred} preferred tech</Badge
			>{/if}
	</div>

	<Card.Root class="py-0">
		<Card.Content class="overflow-x-auto px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Name</Table.Head>
						<Table.Head class="hidden md:table-cell">Contact</Table.Head>
						<Table.Head>Agreement</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head class="text-right">Open balance</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each visible as c (c.id)}
						<Table.Row class="cursor-pointer" onclick={() => goto(`/customers/${c.id}`)}>
							<Table.Cell class="font-medium">
								{c.name}
								{#if c.portalLinked}
									<Badge variant="outline" class="ml-1 px-1 py-0 text-[10px] font-normal"
										>portal</Badge
									>
								{/if}
								{#if c.onHold}
									<Badge
										variant="outline"
										class="ml-1 px-1 py-0 text-[10px] text-red-600 dark:text-red-400">hold</Badge
									>
								{/if}
								{#if c.companyName}<span class="text-muted-foreground">
										· {c.companyName}</span
									>{/if}
								{#if c.hasUpcoming}
									<CalendarCheck class="ml-1 inline size-3.5 align-text-top text-primary" />
								{/if}
								{#if c.tags?.length}
									<span class="ml-1 inline-flex gap-1 align-middle">
										{#each c.tags as t (t)}<Badge variant="secondary" class="font-normal">{t}</Badge
											>{/each}
									</span>
								{/if}
							</Table.Cell>
							<Table.Cell class="hidden text-muted-foreground md:table-cell">
								{c.email ?? c.phone ?? '—'}
							</Table.Cell>
							<Table.Cell class="text-muted-foreground">{c.planName ?? '—'}</Table.Cell>
							<Table.Cell><StatusBadge status={c.status} /></Table.Cell>
							<Table.Cell class="text-right tabular-nums">
								{#if c.openBalance < 0}
									<span class="text-emerald-600">-{formatMoney(-c.openBalance, currency)}</span>
								{:else}
									{c.openBalance > 0 ? formatMoney(c.openBalance, currency) : '—'}
								{/if}
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell colspan={5}>
								<Empty.Root class="border-0">
									<Empty.Header>
										<Empty.Media><Users /></Empty.Media>
										<Empty.Title>No customers yet</Empty.Title>
										<Empty.Description
											>Add your first customer, or load the demo data to look around.</Empty.Description
										>
									</Empty.Header>
									<Empty.Content
										><Button onclick={() => (open = true)}>Add customer</Button></Empty.Content
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
			<Dialog.Title>Add customer</Dialog.Title>
			<Dialog.Description
				>A name is enough to start — contact details are optional.</Dialog.Description
			>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={submit}>
			<Field.Field>
				<Field.Label>Type</Field.Label>
				<Select.Root type="single" bind:value={type}>
					<Select.Trigger class="w-full">{type}</Select.Trigger>
					<Select.Content>
						<Select.Item value="residential">residential</Select.Item>
						<Select.Item value="commercial">commercial</Select.Item>
					</Select.Content>
				</Select.Root>
			</Field.Field>
			{#if type === 'commercial'}
				<Field.Field>
					<Field.Label for="c-company">Company</Field.Label>
					<Input id="c-company" bind:value={companyName} />
				</Field.Field>
			{/if}
			<Field.Field>
				<Field.Label for="c-name">Name</Field.Label>
				<Input id="c-name" required bind:value={name} autofocus />
			</Field.Field>
			<Field.Field>
				<Field.Label for="c-email">Email</Field.Label>
				<Input id="c-email" type="email" bind:value={email} />
			</Field.Field>
			<Field.Field>
				<Field.Label for="c-phone">Phone</Field.Label>
				<Input id="c-phone" bind:value={phone} />
			</Field.Field>
			{#if dupMatches.length}
				<div
					class="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950/30"
				>
					<p class="font-medium">Possible duplicate — already on file:</p>
					<ul class="mt-1 list-inside list-disc text-muted-foreground">
						{#each dupMatches as d (d.customer.id ?? d.customer.name)}
							<li>{d.customer.name} ({d.match})</li>
						{/each}
					</ul>
				</div>
			{/if}
			<Dialog.Footer>
				<Button type="submit" disabled={pending}
					>{pending ? 'Adding…' : dupMatches.length ? 'Create anyway' : 'Add customer'}</Button
				>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={importOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Import customers</Dialog.Title>
			<Dialog.Description>
				Paste CSV or pick a file — columns: name, email, phone (header row optional). Customers
				whose email is already in use are skipped.
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-3">
			<Input type="file" accept=".csv,text/csv,text/plain" onchange={onImportFile} />
			<Textarea
				rows={6}
				class="font-mono text-xs"
				placeholder="name,email,phone&#10;Jane Doe,jane@example.com,555-1234"
				bind:value={importText}
			/>
			{#if importText.trim()}
				<p class="text-xs text-muted-foreground">
					{importRows.length} customer{importRows.length === 1 ? '' : 's'} ready to import
				</p>
			{/if}
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (importOpen = false)}>Cancel</Button>
			<Button onclick={runImport} disabled={importPending || !importRows.length}>
				{importPending ? 'Importing…' : `Import ${importRows.length || ''}`}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
