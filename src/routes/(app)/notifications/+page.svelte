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
	import * as Modal from '#lib/components/ui/modal/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { textCustomerCmd } from '#lib/remote/customers.remote.ts';
	import { errMsg } from '#lib/format.ts';
	import { notificationHref, notificationLabel } from '#lib/notifications.ts';

	let page = $state(50);
	const rows = $derived(await getStaffNotifications({ limit: page }));
	const hasMore = $derived(rows.length >= page);
	const unread = $derived(rows.filter((n) => !n.readAt).length);
	let unreadOnly = $state(false);
	let replyTo = $state<string | null>(null);
	let replyText = $state('');
	let replyPending = $state(false);
	async function sendReply() {
		if (!replyTo || !replyText.trim()) return;
		replyPending = true;
		try {
			await textCustomerCmd({ customerId: replyTo, message: replyText.trim() });
			toast.success('Text sent');
			replyTo = null;
			replyText = '';
		} catch (e) {
			toast.error(errMsg(e, 'Could not send'));
		} finally {
			replyPending = false;
		}
	}
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
</script>

<PageHeader title="Notifications" crumbs={[{ label: 'Home', href: '/dashboard' }]}>
	{#snippet actions()}
		<Select.Root type="single" value={kindFilter} onValueChange={(v) => (kindFilter = v ?? 'all')}>
			<Select.Trigger class="h-8 w-40 text-sm">
				{kindFilter === 'all' ? 'All types' : notificationLabel(kindFilter)}
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="all">All types</Select.Item>
				{#each kinds as k (k)}<Select.Item value={k}>{notificationLabel(k)}</Select.Item>{/each}
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
		<Card.Content class="overflow-x-auto px-0">
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
						{@const link = notificationHref(n.kind, n.entityId)}
						<Table.Row class={n.readAt ? '' : 'bg-primary/5'}>
							<Table.Cell class="pl-6 text-muted-foreground">
								{#if !n.readAt}<span
										class="mr-1.5 inline-block size-2 rounded-full bg-primary align-middle"
									></span>{/if}
								{formatRelative(n.createdAt)}
							</Table.Cell>
							<Table.Cell>
								<Badge variant="secondary" class="mr-2">{notificationLabel(n.kind)}</Badge>
							</Table.Cell>
							<Table.Cell class="hidden text-muted-foreground md:table-cell"
								>{n.recipient}</Table.Cell
							>
							<Table.Cell class="pr-6 text-right">
								{#if n.kind === 'inbound_sms_staff'}
									<Button
										variant="link"
										class="mr-3 h-auto p-0 text-xs"
										onclick={() => {
											replyTo = n.entityId.split(':')[0] ?? null;
											replyText = '';
										}}>Reply</Button
									>
								{/if}
								{#if !n.readAt}
									<Button
										variant="link"
										class="mr-3 h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
										onclick={() => markRead(n.id)}>Mark read</Button
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
			{#if hasMore}
				<div class="flex justify-center pt-3">
					<Button variant="outline" size="sm" onclick={() => (page += 50)}>Load more</Button>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>
</div>

<Modal.Root
	open={replyTo !== null}
	onOpenChange={(v) => {
		if (!v) replyTo = null;
	}}
>
	<Modal.Content>
		<Modal.Header>
			<Modal.Title>Text the customer</Modal.Title>
			<Modal.Description>Sends an SMS via the org's Twilio number.</Modal.Description>
		</Modal.Header>
		<Textarea rows={3} bind:value={replyText} placeholder="Type a reply…" />
		<Modal.Footer>
			<Button variant="outline" onclick={() => (replyTo = null)}>Cancel</Button>
			<Button onclick={sendReply} disabled={replyPending || !replyText.trim()}>Send</Button>
		</Modal.Footer>
	</Modal.Content>
</Modal.Root>
