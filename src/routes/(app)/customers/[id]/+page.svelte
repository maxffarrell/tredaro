<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import PageHeader from '#lib/components/app/page-header.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import { toast } from 'svelte-sonner';
	import {
		getCustomer,
		updateCustomer,
		addServiceLocation,
		updateServiceLocation,
		getPortalInvite
	} from '#lib/remote/customers.remote.ts';
	import { recordPayment } from '#lib/remote/billing.remote.ts';
	import { errMsg, formatDate, formatMoney } from '#lib/format.ts';
	import { localDate, localTime } from '#lib/tz.ts';
	import { getSettings } from '#lib/remote/workspace.remote.ts';
	import Plus from '@lucide/svelte/icons/plus';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Link2 from '@lucide/svelte/icons/link-2';
	import Wrench from '@lucide/svelte/icons/wrench';

	const id = page.params.id!;
	const c = $derived(await getCustomer(id));
	const settings = await getSettings();
	const currency = settings.currency;
	const tz = settings.timezone;

	// ------- customer edit -------
	let name = $state(c.customer.name);
	let type = $state(c.customer.type);
	let companyName = $state(c.customer.companyName);
	let email = $state(c.customer.email);
	let phone = $state(c.customer.phone);
	let notes = $state(c.customer.notes);
	let status = $state(c.customer.status);
	let saving = $state(false);

	async function saveCustomer(e: SubmitEvent) {
		e.preventDefault();
		saving = true;
		try {
			await updateCustomer({ id, name, type, companyName, email, phone, notes, status });
			toast.success('Customer saved');
		} catch (err) {
			toast.error(errMsg(err, 'Could not save'));
		}
		saving = false;
	}

	// ------- locations -------
	let locOpen = $state(false);
	let locPending = $state(false);
	let locId = $state<string | null>(null);
	let label = $state('');
	let address1 = $state('');
	let city = $state('');
	let addrState = $state('');
	let zip = $state('');
	let accessNotes = $state('');

	function openLocation(l?: (typeof c.locations)[number]) {
		locId = l?.id ?? null;
		label = l?.label ?? '';
		address1 = l?.address1 ?? '';
		city = l?.city ?? '';
		addrState = l?.state ?? '';
		zip = l?.zip ?? '';
		accessNotes = l?.accessNotes ?? '';
		locOpen = true;
	}

	async function saveLocation(e: SubmitEvent) {
		e.preventDefault();
		locPending = true;
		try {
			const loc = { label, address1, city, state: addrState, zip, accessNotes };
			if (locId) {
				await updateServiceLocation({ id: locId, ...loc });
			} else {
				await addServiceLocation({ customerId: id, ...loc });
			}
			toast.success('Location saved');
			locOpen = false;
		} catch (err) {
			toast.error(errMsg(err, 'Could not save location'));
		}
		locPending = false;
	}

	// ------- portal link -------
	async function copyPortal() {
		try {
			const { url } = await getPortalInvite(id);
			await navigator.clipboard.writeText(url);
			toast.success('Portal link copied — send it to the customer');
		} catch (err) {
			toast.error(errMsg(err, 'Could not get link'));
		}
	}

	// ------- record payment -------
	let payOpen = $state(false);
	let payPending = $state(false);
	let payDollars = $state('');
	let payMethod = $state<'cash' | 'card' | 'bank' | 'other'>('cash');
	let payNote = $state('');
	const payCents = $derived(Math.round((parseFloat(payDollars) || 0) * 100));

	async function submitPayment(e: SubmitEvent) {
		e.preventDefault();
		payPending = true;
		try {
			await recordPayment({
				customerId: id,
				amount: payCents,
				method: payMethod,
				notes: payNote
			});
			toast.success('Payment recorded');
			payOpen = false;
			payDollars = payNote = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not record payment'));
		}
		payPending = false;
	}
</script>

<PageHeader title={c.customer.name} crumbs={[{ label: 'Customers', href: '/customers' }]}>
	{#snippet actions()}
		<StatusBadge status={c.customer.status} />
		<Button size="sm" variant="outline" onclick={copyPortal}><Link2 /> Portal link</Button>
		<Button size="sm" href="/jobs?new=1&customer={id}"><Wrench /> New job</Button>
	{/snippet}
</PageHeader>

<div class="grid gap-6 p-4 md:p-6 xl:grid-cols-3">
	<!-- customer record + locations -->
	<div class="space-y-6">
		<Card.Root>
			<Card.Header><Card.Title class="text-base">Record</Card.Title></Card.Header>
			<Card.Content>
				<form class="space-y-4" onsubmit={saveCustomer}>
					<div class="grid grid-cols-2 gap-4">
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
						<Field.Field>
							<Field.Label>Status</Field.Label>
							<Select.Root type="single" bind:value={status}>
								<Select.Trigger class="w-full">{status}</Select.Trigger>
								<Select.Content>
									<Select.Item value="active">active</Select.Item>
									<Select.Item value="inactive">inactive</Select.Item>
								</Select.Content>
							</Select.Root>
						</Field.Field>
					</div>
					{#if type === 'commercial'}
						<Field.Field>
							<Field.Label for="cd-company">Company</Field.Label>
							<Input id="cd-company" bind:value={companyName} />
						</Field.Field>
					{/if}
					<Field.Field>
						<Field.Label for="cd-name">Name</Field.Label>
						<Input id="cd-name" required bind:value={name} />
					</Field.Field>
					<Field.Field>
						<Field.Label for="cd-email">Email</Field.Label>
						<Input id="cd-email" type="email" bind:value={email} />
					</Field.Field>
					<Field.Field>
						<Field.Label for="cd-phone">Phone</Field.Label>
						<Input id="cd-phone" bind:value={phone} />
					</Field.Field>
					<Field.Field>
						<Field.Label for="cd-notes">Notes</Field.Label>
						<Textarea id="cd-notes" rows={3} bind:value={notes} />
					</Field.Field>
					<Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
				</form>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header class="flex-row items-center justify-between">
				<Card.Title class="text-base">Service locations</Card.Title>
				<Button size="sm" variant="outline" onclick={() => openLocation()}><MapPin /> Add</Button>
			</Card.Header>
			<Card.Content class="space-y-2 px-4">
				{#each c.locations as l (l.id)}
					<button
						class="w-full rounded-lg border p-3 text-left text-sm transition-colors hover:bg-accent"
						onclick={() => openLocation(l)}
					>
						<div class="flex items-center justify-between">
							<span class="font-medium"
								>{l.label ? `${l.label} — ` : ''}{l.address1 || 'No address'}</span
							>
							{#if l.isPrimary}<StatusBadge status="active" label="primary" />{/if}
						</div>
						<p class="mt-1 text-xs text-muted-foreground">
							{l.city}{#if l.state}, {l.state}{/if}
							{l.zip}
						</p>
					</button>
				{:else}
					<p class="py-3 text-sm text-muted-foreground">No service locations yet.</p>
				{/each}
			</Card.Content>
		</Card.Root>
	</div>

	<!-- activity: jobs / agreements / estimates / billing -->
	<div class="space-y-6 xl:col-span-2">
		<Card.Root>
			<Card.Header class="flex-row items-center justify-between">
				<Card.Title class="text-base">Jobs</Card.Title>
				<Button size="sm" variant="outline" href="/jobs?new=1&customer={id}"><Plus /> New</Button>
			</Card.Header>
			<Card.Content class="px-0">
				<Table.Root>
					<Table.Body>
						{#each c.jobs as j (j.job.id)}
							<Table.Row class="cursor-pointer" onclick={() => goto(`/jobs/${j.job.id}`)}>
								<Table.Cell class="pl-6 font-medium">
									J-{j.job.number}
									{j.job.summary || j.jobTypeName}
								</Table.Cell>
								<Table.Cell class="text-muted-foreground"
									>{j.job.startsAt
										? `${localDate(j.job.startsAt, tz)} ${localTime(j.job.startsAt, tz)}`
										: '—'}</Table.Cell
								>
								<Table.Cell class="pr-6 text-right"
									><StatusBadge status={j.job.status} /></Table.Cell
								>
							</Table.Row>
						{:else}
							<Table.Row
								><Table.Cell class="pl-6 text-muted-foreground">No jobs yet.</Table.Cell></Table.Row
							>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>

		<div class="grid gap-6 lg:grid-cols-2">
			<Card.Root>
				<Card.Header class="flex-row items-center justify-between">
					<Card.Title class="text-base">Agreements</Card.Title>
					<Button size="sm" variant="outline" href="/agreements?new=1&customer={id}"
						><Plus /> New</Button
					>
				</Card.Header>
				<Card.Content class="space-y-2 px-4">
					{#each c.agreements as a (a.agreement.id)}
						<div class="rounded-lg border p-3 text-sm">
							<div class="flex items-center justify-between">
								<span class="font-medium">{a.planName}</span>
								<StatusBadge status={a.agreement.status} />
							</div>
							<p class="mt-1 text-xs text-muted-foreground">
								{formatMoney(a.amount, currency)}/{a.interval}
								· since {formatDate(a.agreement.startsAt)}
								{#if a.agreement.nextChargeAt}· next {formatDate(a.agreement.nextChargeAt)}{/if}
							</p>
						</div>
					{:else}
						<p class="py-3 text-sm text-muted-foreground">No service agreements.</p>
					{/each}
				</Card.Content>
			</Card.Root>

			<Card.Root>
				<Card.Header class="flex-row items-center justify-between">
					<Card.Title class="text-base">Estimates</Card.Title>
					<Button size="sm" variant="outline" href="/estimates?new=1&customer={id}"
						><Plus /> New</Button
					>
				</Card.Header>
				<Card.Content class="px-0">
					<Table.Root>
						<Table.Body>
							{#each c.estimates as e (e.id)}
								<Table.Row class="cursor-pointer" onclick={() => goto(`/estimates/${e.id}`)}>
									<Table.Cell class="pl-6 font-medium">E-{e.number}</Table.Cell>
									<Table.Cell class="text-muted-foreground">{formatDate(e.createdAt)}</Table.Cell>
									<Table.Cell class="pr-6 text-right"><StatusBadge status={e.status} /></Table.Cell>
								</Table.Row>
							{:else}
								<Table.Row
									><Table.Cell class="pl-6 text-muted-foreground">No estimates.</Table.Cell
									></Table.Row
								>
							{/each}
						</Table.Body>
					</Table.Root>
				</Card.Content>
			</Card.Root>
		</div>

		<Card.Root>
			<Card.Header class="flex-row items-center justify-between">
				<Card.Title class="text-base">Billing</Card.Title>
				<div class="flex items-center gap-2">
					{#if c.customer.status === 'active'}
						<Button
							size="sm"
							variant="outline"
							onclick={() => {
								payDollars = '';
								payOpen = true;
							}}>Record payment</Button
						>
					{/if}
					<Button size="sm" variant="ghost" href="/billing?customer={id}">All billing</Button>
				</div>
			</Card.Header>
			<Card.Content>
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="rounded-lg bg-muted/50 p-3">
						<p class="text-xs text-muted-foreground">Open balance</p>
						<p class="text-xl font-semibold tabular-nums">
							{formatMoney(
								c.charges.reduce(
									(sum, ch) => sum + (ch.charge.status === 'open' ? ch.charge.amount - ch.paid : 0),
									0
								),
								currency
							)}
						</p>
					</div>
					<div class="rounded-lg bg-muted/50 p-3">
						<p class="text-xs text-muted-foreground">Lifetime payments</p>
						<p class="text-xl font-semibold tabular-nums">
							{formatMoney(
								c.payments.reduce((sum, p) => sum + p.amount, 0),
								currency
							)}
						</p>
					</div>
				</div>
				<Separator class="my-4" />
				<ul class="space-y-2 text-sm">
					{#each [...c.charges
							.filter((ch) => ch.charge.status === 'open')
							.map( (ch) => ({ d: new Date(`${ch.charge.dueDate}T00:00:00Z`), label: ch.charge.description || 'Charge', status: ch.charge.status, cents: ch.charge.amount - ch.paid }) ), ...c.payments.map( (p) => ({ d: p.paidAt, label: `Payment — ${p.method}`, status: 'paid', cents: -p.amount }) )]
						.sort((a, b) => b.d.getTime() - a.d.getTime())
						.slice(0, 10) as row (row.label + row.d.getTime())}
						<li class="flex items-center justify-between">
							<span class="truncate"
								>{row.label}
								<span class="text-xs text-muted-foreground">{formatDate(row.d)}</span></span
							>
							<span class="tabular-nums {row.cents < 0 ? 'text-emerald-600' : ''}"
								>{row.cents < 0 ? '−' : ''}{formatMoney(Math.abs(row.cents), currency)}</span
							>
						</li>
					{:else}
						<li class="text-muted-foreground">No billing activity.</li>
					{/each}
				</ul>
			</Card.Content>
		</Card.Root>
	</div>
</div>

<!-- location dialog -->
<Dialog.Root bind:open={locOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{locId ? 'Edit' : 'Add'} service location</Dialog.Title>
			<Dialog.Description
				>Where the work happens — an address plus optional on-site contact.</Dialog.Description
			>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={saveLocation}>
			<Field.Field>
				<Field.Label for="l-label">Label</Field.Label>
				<Input id="l-label" bind:value={label} placeholder="Home, Warehouse, Unit 4…" />
			</Field.Field>
			<Field.Field>
				<Field.Label for="l-addr1">Address</Field.Label>
				<Input id="l-addr1" bind:value={address1} placeholder="Street" />
			</Field.Field>
			<div class="grid grid-cols-3 gap-4">
				<Input bind:value={city} placeholder="City" />
				<Input bind:value={addrState} placeholder="State" />
				<Input bind:value={zip} placeholder="ZIP" />
			</div>
			<Field.Field>
				<Field.Label for="l-access">Access notes</Field.Label>
				<Input id="l-access" bind:value={accessNotes} placeholder="Gate code, key location…" />
			</Field.Field>
			<Dialog.Footer>
				<Button type="submit" disabled={locPending}>{locPending ? 'Saving…' : 'Save'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<!-- record payment dialog -->
<Dialog.Root bind:open={payOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Record payment</Dialog.Title>
			<Dialog.Description>
				Collected outside Tredaro — applies to the oldest open charges first.
			</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={submitPayment}>
			<Field.Field>
				<Field.Label for="p-amt">Amount</Field.Label>
				<Input
					id="p-amt"
					type="number"
					step="0.01"
					min="0.01"
					required
					bind:value={payDollars}
					placeholder="0.00"
				/>
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
				<Field.Label for="p-note">Note</Field.Label>
				<Input id="p-note" bind:value={payNote} placeholder="Optional" />
			</Field.Field>
			<Dialog.Footer>
				<Button type="submit" disabled={payPending || payCents <= 0}
					>{payPending
						? 'Saving…'
						: `Record ${payCents ? formatMoney(payCents, currency) : ''}`}</Button
				>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
