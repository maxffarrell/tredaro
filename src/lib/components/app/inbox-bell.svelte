<script lang="ts">
	import { goto } from '$app/navigation';
	import Bell from '@lucide/svelte/icons/bell';
	import CheckCheck from '@lucide/svelte/icons/check-check';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Popover from '#lib/components/ui/popover/index.js';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import {
		getStaffNotifications,
		getUnreadNotificationCount,
		markAllNotificationsRead,
		markNotificationRead
	} from '#lib/remote/workspace.remote.ts';
	import { notificationHref, notificationLabel } from '#lib/notifications.ts';
	import { formatRelative } from '#lib/format.ts';

	const items = $derived(await getStaffNotifications({ limit: 20 }));
	const unread = $derived(await getUnreadNotificationCount());
	let open = $state(false);

	async function read(id: string, href: string | null) {
		try {
			await markNotificationRead(id);
		} catch {
			/* non-fatal */
		}
		open = false;
		if (href) goto(href);
	}

	async function markAll() {
		try {
			await markAllNotificationsRead({});
		} catch {
			/* non-fatal */
		}
	}
</script>

<Popover.Root
	bind:open
	onOpenChange={(v) => {
		if (v) {
			void getStaffNotifications({ limit: 20 }).refresh();
			void getUnreadNotificationCount().refresh();
		}
	}}
>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Sidebar.MenuButton
				{...props}
				variant="outline"
				tooltipContent="Notifications"
				class="relative aspect-square !w-auto shrink-0 px-2 text-muted-foreground"
			>
				<Bell />
				{#if unread}
					<span
						class="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground"
					>
						{unread > 9 ? '9+' : unread}
					</span>
				{/if}
			</Sidebar.MenuButton>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content side="right" align="start" sideOffset={8} class="w-80 p-0 sm:w-96">
		<div class="flex items-center justify-between border-b px-4 py-2.5">
			<span class="text-sm font-medium">Notifications</span>
			{#if unread}
				<Button variant="ghost" size="sm" class="h-7 gap-1.5 px-2 text-xs" onclick={markAll}>
					<CheckCheck class="size-3.5" /> Mark all read
				</Button>
			{/if}
		</div>
		{#if items.length === 0}
			<p class="px-4 py-8 text-center text-sm text-muted-foreground">You're all caught up.</p>
		{:else}
			<ul class="max-h-96 divide-y overflow-y-auto">
				{#each items as n (n.id)}
					{@const link = notificationHref(n.kind, n.entityId)}
					<li>
						<button
							class="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60"
							onclick={() => read(n.id, link)}
						>
							<span
								class="mt-1.5 size-2 shrink-0 rounded-full {n.readAt
									? 'bg-transparent'
									: 'bg-primary'}"
							></span>
							<span class="min-w-0 flex-1">
								<span
									class="block truncate text-sm {n.readAt
										? 'text-muted-foreground'
										: 'font-medium'}"
								>
									{notificationLabel(n.kind)}
								</span>
								<span class="mt-1 block text-[11px] text-muted-foreground/70">
									{formatRelative(n.createdAt)}
								</span>
							</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
		<div class="border-t px-4 py-2">
			<a
				href="/notifications"
				class="text-xs text-muted-foreground hover:text-foreground"
				onclick={() => (open = false)}
			>
				View all notifications
			</a>
		</div>
	</Popover.Content>
</Popover.Root>
