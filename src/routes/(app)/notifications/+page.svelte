<script lang="ts">
	import PageHeader from '#lib/components/app/page-header.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import {
		getStaffNotifications,
		getUnreadNotificationCount,
		markAllNotificationsRead,
		markNotificationRead
	} from '#lib/remote/workspace.remote.ts';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import CheckCheck from '@lucide/svelte/icons/check-check';
	import Filter from '@lucide/svelte/icons/filter';
	import { formatRelative } from '#lib/format.ts';
	import Bell from '@lucide/svelte/icons/bell';
	import { toast } from 'svelte-sonner';
	import { errMsg } from '#lib/format.ts';

	const rows = $derived(await getStaffNotifications());
	const unread = $derived(rows.filter((n) => !n.readAt).length);
	let unreadOnly = $state(false);
	let kindFilter = $state('all');
	const kinds = $derived([...new Set(rows.map((n) => n.kind))]);
	const shown = $derived(
		rows.filter(
			(n) => (!unreadOnly || !n.readAt) && (kindFilter === 'all' || n.kind === kindFilter)
		)
	);

	async function markRead(id: string) {
		try {
			await markNotificationRead(id).updates(getStaffNotifications, getUnreadNotificationCount);
		} catch {
			/* non-fatal */
		}
	}

	async function markAllRead() {
		try {
			await markAllNotificationsRead({}).updates(getStaffNotifications, getUnreadNotificationCount);
		} catch (err) {
			toast.error(errMsg(err, 'Could not mark notifications read'));
		}
	}

	const KIND_LABELS: Record<string, string> = {
		booking_staff_alert: 'Booking request',
		estimate_viewed: 'Estimate viewed',
		estimate_decision: 'Estimate answered',
		low_stock: 'Low stock',
		parts_delay: 'Parts delay',
		tech_assigned: 'Tech assigned',
		daily_digest: 'Daily digest',
		agreement_renewal: 'Agreement renewal',
		job_completed: 'Job completed',
		payment_receipt: 'Payment received',
		inbound_sms_staff: 'Text from customer',
		estimate_changes: 'Change request',
		quote_request: 'Quote request'
	};

	/** Where each kind's entity usually lives. */
	function href(kind: string, entityId: string) {
		if (kind === 'booking_staff_alert' || kind === 'daily_digest') return '/dispatch';
		if (kind === 'low_stock') return '/inventory';
		if (
			kind === 'estimate_viewed' ||
			kind === 'estimate_decision' ||
			kind === 'estimate_changes' ||
			kind === 'quote_request'
		)
			return `/estimates/${entityId}`;
		if (kind === 'parts_delay' || kind === 'tech_assigned') return `/jobs/${entityId}`;
		if (kind === 'agreement_renewal') return '/agreements';
		if (kind === 'payment_receipt' || kind === 'job_completed') return `/jobs/${entityId}`;
		if (kind === 'inbound_sms_staff') return `/customers/${entityId.split(':')[0]}`;
		return null;
	}
</script>

<PageHeader title="Notifications" crumbs={[{ label: 'Home', href: '/dashboard' }]}>
	{#snippet actions()}
		<Select.Root type="single" value={kindFilter} onValueChange={(v) => (kindFilter = v ?? 'all')}>
			<Select.Trigger class="h-8 w-40 text-sm">
				{kindFilter === 'all' ? 'All types' : (KIND_LABELS[kindFilter] ?? kindFilter)}
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="all">All types</Select.Item>
				{#each kinds as k (k)}<Select.Item value={k}>{KIND_LABELS[k] ?? k}</Select.Item>{/each}
			</Select.Content>
		</Select.Root>
		<Button
			size="sm"
			variant={unreadOnly ? 'secondary' : 'ghost'}
			onclick={() => (unreadOnly = !unreadOnly)}><Filter /> Unread</Button
		>
		{#if unread > 0}
			<Button size="sm" variant="outline" onclick={markAllRead}
				><CheckCheck /> Mark all read ({unread})</Button
			>
		{/if}
	{/snippet}
</PageHeader>

<div class="space-y-4 p-4 md:p-6">
	<Card.Root class="py-0">
		<Card.Content class="px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head class="w-40 pl-6">When</Table.Head>
						<Table.Head>Notification</Table.Head>
						<Table.Head class="hidden md:table-cell">Sent to</Table.Head>
						<Table.Head class="pr-6"></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each shown as n (n.id)}
						{@const link = href(n.kind, n.entityId)}
						<Table.Row class={n.readAt ? '' : 'bg-primary/5'}>
							<Table.Cell class="pl-6 text-muted-foreground">
								{#if !n.readAt}<span
										class="mr-1.5 inline-block size-2 rounded-full bg-primary align-middle"
									></span>{/if}
								{formatRelative(n.createdAt)}
							</Table.Cell>
							<Table.Cell>
								<Badge variant="secondary" class="mr-2"
									>{KIND_LABELS[n.kind] ?? n.kind.replaceAll('_', ' ')}</Badge
								>
							</Table.Cell>
							<Table.Cell class="hidden text-muted-foreground md:table-cell"
								>{n.recipient}</Table.Cell
							>
							<Table.Cell class="pr-6 text-right">
								{#if !n.readAt}
									<button
										class="mr-3 text-xs text-muted-foreground hover:text-foreground hover:underline"
										onclick={() => markRead(n.id)}>Mark read</button
									>
								{/if}
								{#if link}
									<a
										class="text-xs text-primary hover:underline"
										href={link}
										onclick={() => {
											if (!n.readAt) void markRead(n.id);
										}}>Open</a
									>
								{/if}
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell colspan={4}>
								<Empty.Root>
									<Empty.Media><Bell /></Empty.Media>
									<Empty.Title>No notifications yet</Empty.Title>
									<Empty.Description>
										Booking alerts, estimate answers, low stock and the morning digest land here.
									</Empty.Description>
								</Empty.Root>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>
</div>
