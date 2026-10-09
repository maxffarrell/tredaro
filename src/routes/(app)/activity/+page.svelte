<script lang="ts">
	import PageHeader from '#lib/components/app/page-header.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import {
		getActivity,
		getActivityTodayCount,
		getActivityActors,
		getActivityTypes,
		getActivityWeekCount
	} from '#lib/remote/workspace.remote.ts';
	import { formatRelative } from '#lib/format.ts';
	import History from '@lucide/svelte/icons/history';
	import { Button } from '#lib/components/ui/button/index.js';

	const types = await getActivityTypes();
	const actors = await getActivityActors();
	let entityType = $state('');
	let actorId = $state('');
	let limit = $state(200);
	let rows = $state(await getActivity({ limit }));
	const todayCount = $derived(await getActivityTodayCount());
	const weekCount = $derived(await getActivityWeekCount());
	const hasMore = $derived(rows.length >= limit);

	async function refilter(v: string) {
		entityType = v;
		rows = await getActivity({
			entityType: v || undefined,
			actorId: actorId || undefined,
			limit
		});
	}

	async function refilterActor(v: string) {
		actorId = v;
		rows = await getActivity({
			entityType: entityType || undefined,
			actorId: v || undefined,
			limit
		});
	}

	/** Link to an entity's page when we know its route. */
	function entityHref(t: string, id: string) {
		return (
			{
				job: `/jobs/${id}`,
				customer: `/customers/${id}`,
				estimate: `/estimates/${id}`,
				invoice: `/billing`,
				service_agreement: `/agreements`,
				inventory_item: `/inventory`
			}[t] ?? null
		);
	}
</script>

<PageHeader title="Activity" crumbs={[{ label: 'Home', href: '/dashboard' }]} />

<div class="space-y-4 p-4 md:p-6">
	{#if types.length}
		<Select.Root type="single" value={entityType} onValueChange={refilter}>
			<Select.Trigger class="w-48">{entityType || 'Everything'}</Select.Trigger>
			<Select.Content>
				<Select.Item value="">Everything</Select.Item>
				{#each types as t (t)}
					<Select.Item value={t}>{t.replaceAll('_', ' ')}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	{/if}
	{#if actors.length}
		<Select.Root type="single" value={actorId} onValueChange={refilterActor}>
			<Select.Trigger class="w-48"
				>{actorId
					? (actors.find((a) => a.actorId === actorId)?.name ?? 'Anyone')
					: 'Anyone'}</Select.Trigger
			>
			<Select.Content>
				<Select.Item value="">Anyone</Select.Item>
				{#each actors as a (a.actorId)}
					<Select.Item value={a.actorId!}>{a.name}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	{/if}
	{#if todayCount}
		<p class="text-sm text-muted-foreground">
			{todayCount} event{todayCount === 1 ? '' : 's'} today{#if weekCount > todayCount}
				· {weekCount} this week{/if}
		</p>
	{/if}

	<Card.Root class="py-0">
		<Card.Content class="px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head class="w-40">When</Table.Head>
						<Table.Head>Event</Table.Head>
						<Table.Head class="hidden md:table-cell">By</Table.Head>
						<Table.Head class="hidden md:table-cell">Type</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each rows as r (r.activity.id)}
						{@const href = entityHref(r.activity.entityType, r.activity.entityId)}
						<Table.Row>
							<Table.Cell class="whitespace-nowrap text-muted-foreground">
								{formatRelative(r.activity.createdAt)}
							</Table.Cell>
							<Table.Cell>
								{#if href}
									<a {href} class="hover:underline">{r.activity.summary}</a>
								{:else}
									{r.activity.summary}
								{/if}
							</Table.Cell>
							<Table.Cell class="hidden text-muted-foreground md:table-cell">
								{r.actorName ?? r.actorEmail ?? 'System'}
							</Table.Cell>
							<Table.Cell class="hidden md:table-cell">
								<Badge variant="secondary" class="font-normal capitalize"
									>{r.activity.entityType.replaceAll('_', ' ')} · {r.activity.action.replaceAll(
										'_',
										' '
									)}</Badge
								>
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell colspan={4}>
								<Empty.Root class="border-0">
									<Empty.Header>
										<Empty.Media><History /></Empty.Media>
										<Empty.Title>No activity yet</Empty.Title>
										<Empty.Description
											>Jobs, invoices, and customer changes show up here as they happen.</Empty.Description
										>
									</Empty.Header>
								</Empty.Root>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
			{#if hasMore}
				<div class="flex justify-center pt-3">
					<Button
						variant="outline"
						size="sm"
						onclick={async () => {
							limit += 200;
							rows = await getActivity({
								entityType: entityType || undefined,
								actorId: actorId || undefined,
								limit
							});
						}}>Load more</Button
					>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
