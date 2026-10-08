<script lang="ts">
	import PageHeader from '#lib/components/app/page-header.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { getStaffNotifications } from '#lib/remote/workspace.remote.ts';
	import { formatRelative } from '#lib/format.ts';
	import Bell from '@lucide/svelte/icons/bell';

	const rows = await getStaffNotifications();

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
		payment_receipt: 'Payment received'
	};

	/** Where each kind's entity usually lives. */
	function href(kind: string, entityId: string) {
		if (kind === 'booking_staff_alert' || kind === 'daily_digest') return '/dispatch';
		if (kind === 'low_stock') return '/inventory';
		if (kind === 'estimate_viewed' || kind === 'estimate_decision') return `/estimates/${entityId}`;
		if (kind === 'parts_delay' || kind === 'tech_assigned') return `/jobs/${entityId}`;
		if (kind === 'agreement_renewal') return '/agreements';
		if (kind === 'payment_receipt' || kind === 'job_completed') return `/jobs/${entityId}`;
		return null;
	}
</script>

<PageHeader title="Notifications" crumbs={[{ label: 'Home', href: '/dashboard' }]} />

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
					{#each rows as n (n.id)}
						{@const link = href(n.kind, n.entityId)}
						<Table.Row>
							<Table.Cell class="pl-6 text-muted-foreground"
								>{formatRelative(n.createdAt)}</Table.Cell
							>
							<Table.Cell>
								<Badge variant="secondary" class="mr-2"
									>{KIND_LABELS[n.kind] ?? n.kind.replaceAll('_', ' ')}</Badge
								>
							</Table.Cell>
							<Table.Cell class="hidden text-muted-foreground md:table-cell"
								>{n.recipient}</Table.Cell
							>
							<Table.Cell class="pr-6 text-right">
								{#if link}
									<a class="text-xs text-primary hover:underline" href={link}>Open</a>
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
