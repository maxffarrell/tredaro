<script lang="ts">
	import PageHeader from '#lib/components/app/page-header.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { getActivity, getActivityTypes } from '#lib/remote/workspace.remote.ts';
	import { formatRelative } from '#lib/format.ts';
	import History from '@lucide/svelte/icons/history';

	const types = await getActivityTypes();
	let entityType = $state('');
	let rows = $state(await getActivity({}));

	async function refilter(v: string) {
		entityType = v;
		rows = await getActivity({ entityType: v || undefined });
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
								<Badge variant="secondary" class="font-normal"
									>{r.activity.entityType}.{r.activity.action}</Badge
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
		</Card.Content>
	</Card.Root>
</div>
