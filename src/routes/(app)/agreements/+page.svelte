<script lang="ts">
	import { page } from '$app/state';
	import PageHeader from '#lib/components/app/page-header.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import MoneyInput from '#lib/components/app/money-input.svelte';
	import { toast } from 'svelte-sonner';
	import {
		getPlans,
		createPlan,
		updatePlan,
		getAgreements,
		createAgreement,
		updateAgreement,
		getCurrency
	} from '#lib/remote/billing.remote.ts';
	import { getCustomers } from '#lib/remote/customers.remote.ts';
	import { getJobTypes } from '#lib/remote/jobs.remote.ts';
	import { errMsg, formatDate, formatMoney } from '#lib/format.ts';
	import Plus from '@lucide/svelte/icons/plus';
	import Pause from '@lucide/svelte/icons/pause';
	import Play from '@lucide/svelte/icons/play';
	import Ban from '@lucide/svelte/icons/ban';

	const currency = await getCurrency();
	const customers = await getCustomers();
	const plans = $derived(await getPlans());
	const jobTypes = $derived(await getJobTypes());
	const agreements = $derived(await getAgreements());

	// ------- plan dialog -------
	let planOpen = $state(false);
	let planId = $state<string | null>(null);
	let planPending = $state(false);
	let planName = $state('');
	let planDesc = $state('');
	let planInterval = $state<'month' | 'year'>('month');
	let planPrice = $state(0);
	let planInitial = $state(0);
	let planVisits = $state(0);
	let planJobTypeId = $state('');

	function openPlan(p?: (typeof plans)[number]) {
		planId = p?.id ?? null;
		planName = p?.name ?? '';
		planDesc = p?.description ?? '';
		planInterval = p?.interval ?? 'month';
		planPrice = p?.amount ?? 0;
		planInitial = p?.initialFee ?? 0;
		planVisits = p?.includedVisits ?? 0;
		planJobTypeId = p?.jobTypeId ?? '';
		planOpen = true;
	}

	async function savePlan(e: SubmitEvent) {
		e.preventDefault();
		planPending = true;
		try {
			const input = {
				name: planName,
				description: planDesc,
				interval: planInterval,
				amount: planPrice,
				initialFee: planInitial,
				includedVisits: planVisits || null,
				jobTypeId: planJobTypeId || null
			};
			if (planId) {
				await updatePlan({ id: planId, ...input });
			} else {
				await createPlan(input);
			}
			toast.success('Plan saved');
			planOpen = false;
		} catch (err) {
			toast.error(errMsg(err, 'Could not save plan'));
		}
		planPending = false;
	}

	// ------- agreement dialog -------
	let agOpen = $state(page.url.searchParams.get('new') === '1');
	let agPending = $state(false);
	let agCustomerId = $state(page.url.searchParams.get('customer') ?? '');
	let agPlanId = $state('');
	let agStart = $state(new Date().toISOString().slice(0, 10));

	async function saveAgreement(e: SubmitEvent) {
		e.preventDefault();
		agPending = true;
		try {
			await createAgreement({
				customerId: agCustomerId,
				planId: agPlanId,
				startsAt: agStart
			});
			toast.success('Agreement created — initial charge posted');
			agOpen = false;
		} catch (err) {
			toast.error(errMsg(err, 'Could not create agreement'));
		}
		agPending = false;
	}

	async function setStatus(id: string, status: 'paused' | 'cancelled' | 'active') {
		try {
			await updateAgreement({ id, status });
			toast.success(`Agreement ${status === 'active' ? 'resumed' : status}`);
		} catch (err) {
			toast.error(errMsg(err, 'Could not update'));
		}
	}
</script>

<PageHeader title="Service agreements">
	{#snippet actions()}
		<Button size="sm" variant="outline" onclick={() => openPlan()}><Plus /> New plan</Button>
		<Button size="sm" onclick={() => (agOpen = true)}><Plus /> New agreement</Button>
	{/snippet}
</PageHeader>

<div class="space-y-4 p-4 md:p-6">
	<Tabs.Root value="agreements">
		<Tabs.List>
			<Tabs.Trigger value="agreements">Agreements</Tabs.Trigger>
			<Tabs.Trigger value="plans">Plans</Tabs.Trigger>
		</Tabs.List>

		<Tabs.Content value="agreements">
			<Card.Root class="py-0">
				<Card.Content class="px-0">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Customer</Table.Head>
								<Table.Head>Plan</Table.Head>
								<Table.Head class="hidden md:table-cell">Started</Table.Head>
								<Table.Head class="hidden md:table-cell">Next billing</Table.Head>
								<Table.Head>Status</Table.Head>
								<Table.Head class="w-28 text-right"></Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each agreements as a (a.agreement.id)}
								<Table.Row>
									<Table.Cell class="font-medium">
										<a href="/customers/{a.agreement.customerId}" class="hover:underline"
											>{a.customerName}</a
										>
									</Table.Cell>
									<Table.Cell
										>{a.planName}
										<span class="text-muted-foreground"
											>{formatMoney(a.amount, currency)}/{a.interval}</span
										></Table.Cell
									>
									<Table.Cell class="hidden text-muted-foreground md:table-cell"
										>{formatDate(a.agreement.startsAt)}</Table.Cell
									>
									<Table.Cell class="hidden text-muted-foreground md:table-cell"
										>{a.agreement.status === 'active'
											? formatDate(a.agreement.nextChargeAt)
											: '—'}</Table.Cell
									>
									<Table.Cell><StatusBadge status={a.agreement.status} /></Table.Cell>
									<Table.Cell class="text-right">
										{#if a.agreement.status === 'active'}
											<Button
												variant="ghost"
												size="icon"
												class="size-8"
												title="Pause"
												onclick={() => setStatus(a.agreement.id, 'paused')}
												><Pause class="size-4" /></Button
											>
											<Button
												variant="ghost"
												size="icon"
												class="size-8 text-destructive"
												title="Cancel"
												onclick={() => setStatus(a.agreement.id, 'cancelled')}
												><Ban class="size-4" /></Button
											>
										{:else if a.agreement.status === 'paused'}
											<Button
												variant="ghost"
												size="icon"
												class="size-8"
												title="Resume"
												onclick={() => setStatus(a.agreement.id, 'active')}
												><Play class="size-4" /></Button
											>
										{/if}
									</Table.Cell>
								</Table.Row>
							{:else}
								<Table.Row
									><Table.Cell colspan={6} class="text-center text-muted-foreground"
										>No agreements yet.</Table.Cell
									></Table.Row
								>
							{/each}
						</Table.Body>
					</Table.Root>
				</Card.Content>
			</Card.Root>
		</Tabs.Content>

		<Tabs.Content value="plans">
			<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
				{#each plans as p (p.id)}
					<button class="text-left" onclick={() => openPlan(p)}>
						<Card.Root class="h-full transition-shadow hover:shadow-sm">
							<Card.Header>
								<div class="flex items-center justify-between">
									<Card.Title class="text-base">{p.name}</Card.Title>
									{#if !p.active}<StatusBadge status="inactive" />{/if}
								</div>
								<Card.Description>{p.description}</Card.Description>
							</Card.Header>
							<Card.Content>
								<p class="text-2xl font-semibold tabular-nums">
									{formatMoney(p.amount, currency)}<span
										class="text-sm font-normal text-muted-foreground">/{p.interval}</span
									>
								</p>
								{#if p.initialFee}
									<p class="text-xs text-muted-foreground">
										+ {formatMoney(p.initialFee, currency)} initial fee
									</p>
								{/if}
								<p class="mt-2 text-xs text-muted-foreground">
									{p.activeCustomers} active customer{p.activeCustomers === 1 ? '' : 's'}
									{#if p.includedVisits}· {p.includedVisits} visit{p.includedVisits > 1
											? 's'
											: ''}/{p.interval === 'month' ? 'mo' : 'yr'}{/if}
								</p>
							</Card.Content>
						</Card.Root>
					</button>
				{:else}
					<p class="text-sm text-muted-foreground">No plans yet — create one to sell agreements.</p>
				{/each}
			</div>
		</Tabs.Content>
	</Tabs.Root>
</div>

<!-- plan dialog -->
<Dialog.Root bind:open={planOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{planId ? 'Edit' : 'New'} plan</Dialog.Title>
			<Dialog.Description
				>A recurring maintenance/contract tier customers subscribe to.</Dialog.Description
			>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={savePlan}>
			<Field.Field>
				<Field.Label for="pl-name">Name</Field.Label>
				<Input id="pl-name" required bind:value={planName} placeholder="Comfort Club" />
			</Field.Field>
			<Field.Field>
				<Field.Label for="pl-desc">Description</Field.Label>
				<Textarea id="pl-desc" rows={2} bind:value={planDesc} />
			</Field.Field>
			<div class="grid grid-cols-2 gap-4">
				<Field.Field>
					<Field.Label>Billing</Field.Label>
					<Select.Root type="single" bind:value={planInterval}>
						<Select.Trigger class="w-full">{planInterval}</Select.Trigger>
						<Select.Content>
							<Select.Item value="month">monthly</Select.Item>
							<Select.Item value="year">yearly</Select.Item>
						</Select.Content>
					</Select.Root>
				</Field.Field>
				<Field.Field>
					<Field.Label>Price</Field.Label>
					<MoneyInput bind:value={planPrice} />
				</Field.Field>
			</div>
			<div class="grid grid-cols-2 gap-4">
				<Field.Field>
					<Field.Label>Initial fee (one-time)</Field.Label>
					<MoneyInput bind:value={planInitial} />
				</Field.Field>
				<Field.Field>
					<Field.Label for="pl-visits">Included visits / period</Field.Label>
					<Input id="pl-visits" type="number" min={0} max={50} bind:value={planVisits} />
				</Field.Field>
			</div>
			<Field.Field>
				<Field.Label>Visit job type</Field.Label>
				<Select.Root type="single" bind:value={planJobTypeId}>
					<Select.Trigger class="w-full"
						>{jobTypes.find((t) => t.id === planJobTypeId)?.name ?? 'None'}</Select.Trigger
					>
					<Select.Content>
						{#each jobTypes.filter((t) => t.active) as t (t.id)}
							<Select.Item value={t.id}>{t.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				<Field.Description
					>Each billing period auto-creates this many unscheduled jobs of this type for dispatch.</Field.Description
				>
			</Field.Field>
			<Dialog.Footer>
				<Button type="submit" disabled={planPending}>{planPending ? 'Saving…' : 'Save plan'}</Button
				>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<!-- agreement dialog -->
<Dialog.Root bind:open={agOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>New agreement</Dialog.Title>
			<Dialog.Description
				>Posts the initial fee plus the first billing period now.</Dialog.Description
			>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={saveAgreement}>
			<Field.Field>
				<Field.Label>Customer</Field.Label>
				<Select.Root type="single" bind:value={agCustomerId}>
					<Select.Trigger class="w-full"
						>{customers.find((c) => c.id === agCustomerId)?.name ?? 'Choose'}</Select.Trigger
					>
					<Select.Content>
						{#each customers as c (c.id)}
							<Select.Item value={c.id}>{c.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</Field.Field>
			<Field.Field>
				<Field.Label>Plan</Field.Label>
				<Select.Root type="single" bind:value={agPlanId}>
					<Select.Trigger class="w-full"
						>{plans.find((p) => p.id === agPlanId)?.name ?? 'Choose'}</Select.Trigger
					>
					<Select.Content>
						{#each plans.filter((p) => p.active) as p (p.id)}
							<Select.Item value={p.id}
								>{p.name} — {formatMoney(p.amount, currency)}/{p.interval}</Select.Item
							>
						{/each}
					</Select.Content>
				</Select.Root>
			</Field.Field>
			<Field.Field>
				<Field.Label for="ag-start">Start date</Field.Label>
				<Input id="ag-start" type="date" bind:value={agStart} />
			</Field.Field>
			<Dialog.Footer>
				<Button type="submit" disabled={agPending || !agCustomerId || !agPlanId}
					>{agPending ? 'Creating…' : 'Create agreement'}</Button
				>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
