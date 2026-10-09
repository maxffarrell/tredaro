<script lang="ts">
	import PageHeader from '#lib/components/app/page-header.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import { getDashboard } from '#lib/remote/workspace.remote.ts';
	import { formatMoney, formatRelative } from '#lib/format.ts';
	import { localTime } from '#lib/tz.ts';
	import Users from '@lucide/svelte/icons/users';
	import Wrench from '@lucide/svelte/icons/wrench';

	import Inbox from '@lucide/svelte/icons/inbox';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Wallet from '@lucide/svelte/icons/wallet';
	import CalendarPlus from '@lucide/svelte/icons/calendar-plus';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { goto } from '$app/navigation';

	const d = await getDashboard();
	const kpis = [
		{
			label: 'Active customers',
			value: String(d.activeCustomers),
			icon: Users,
			href: '/customers'
		},
		{
			label: 'Unscheduled jobs',
			value: String(d.unscheduledJobs),
			icon: Inbox,
			href: '/dispatch'
		},
		{
			label: 'Jobs in flight',
			value: String(d.inFlightJobs),
			icon: Wrench,
			href: '/jobs?status=in_progress'
		},
		{ label: 'Done today', value: String(d.doneToday), icon: Wrench, href: '/jobs' },
		{
			label: 'Bookings (7d)',
			value: String(d.newBookings7d),
			icon: CalendarPlus,
			href: '/dispatch'
		},
		{
			label: 'Collected today',
			value: formatMoney(d.collectedToday, d.currency, true),
			icon: Wallet,
			href: '/billing'
		},
		{
			label: 'Agreements MRR',
			value: formatMoney(d.mrr, d.currency, true),
			icon: RefreshCw,
			href: '/agreements'
		},
		{
			label: 'Overdue balance',
			value: formatMoney(d.overdueTotal, d.currency),
			icon: TriangleAlert,
			href: '/billing?status=open'
		}
	];
</script>

<PageHeader title="Dashboard" />

<div class="space-y-6 p-4 md:p-6">
	<div class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
		{#each kpis as k (k.label)}
			<Card.Root
				class="cursor-pointer py-4 transition-shadow hover:shadow-sm"
				onclick={() => goto(k.href)}
			>
				<Card.Content class="px-4">
					<div class="flex items-center gap-2 text-xs text-muted-foreground">
						<k.icon class="size-3.5" />{k.label}
					</div>
					<div class="mt-1 text-2xl font-semibold tracking-tight">{k.value}</div>
				</Card.Content>
			</Card.Root>
		{/each}
	</div>

	<div class="grid grid-cols-1 gap-6 xl:grid-cols-3">
		<Card.Root class="min-w-0 xl:col-span-2">
			<Card.Header>
				<Card.Title class="text-base">Today's route</Card.Title>
			</Card.Header>
			<Card.Content class="px-4">
				{#if d.todayJobs.length === 0}
					<p class="py-6 text-center text-sm text-muted-foreground">
						Nothing scheduled today.
						<a href="/dispatch" class="underline">Check the dispatch board.</a>
					</p>
				{:else}
					<Table.Root>
						<Table.Body>
							{#each d.todayJobs as j (j.id)}
								<Table.Row onclick={() => goto(`/jobs/${j.id}`)} class="cursor-pointer">
									<Table.Cell>
										<span class="mr-2 inline-block size-2 rounded-full" style:background={j.color}
										></span>{j.summary || j.jobTypeName}
										<span class="text-muted-foreground">· {j.customerName}</span>
										{#if j.technicianName}<span class="text-muted-foreground"
												>· {j.technicianName}</span
											>{/if}
									</Table.Cell>
									<Table.Cell class="w-24 text-muted-foreground"
										>{j.startsAt ? localTime(j.startsAt, d.timezone) : '—'}</Table.Cell
									>
									<Table.Cell class="w-28 text-right">
										<StatusBadge status={j.status} />
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				{/if}
			</Card.Content>
		</Card.Root>

		<div class="space-y-6">
			{#if d.attention.length}
				<Card.Root>
					<Card.Header>
						<Card.Title class="text-base">Needs attention</Card.Title>
					</Card.Header>
					<Card.Content class="px-4">
						<ul class="space-y-2">
							{#each d.attention as a (a.text + a.sub)}
								<li>
									<a href={a.href} class="flex items-start gap-2 text-sm hover:underline">
										<span
											class="mt-1.5 size-1.5 shrink-0 rounded-full"
											class:bg-destructive={a.tone === 'red'}
											class:bg-amber-500={a.tone === 'amber'}
											class:bg-blue-500={a.tone === 'blue'}
										></span>
										<span class="min-w-0 flex-1">
											<span class="block truncate">{a.text}</span>
											<span class="block truncate text-xs text-muted-foreground">{a.sub}</span>
										</span>
										{#if a.amountCents != null}
											<span class="shrink-0 text-xs font-medium"
												>{formatMoney(a.amountCents, d.currency)}</span
											>
										{/if}
									</a>
								</li>
							{/each}
						</ul>
					</Card.Content>
				</Card.Root>
			{/if}

			<Card.Root>
				<Card.Header><Card.Title class="text-base">Recent activity</Card.Title></Card.Header>
				<Card.Content class="px-4">
					{#if d.recentActivity.length === 0}
						<p class="py-4 text-sm text-muted-foreground">Nothing yet.</p>
					{:else}
						<ul class="space-y-3">
							{#each d.recentActivity.slice(0, 8) as a (a.id)}
								<li class="flex items-start gap-2 text-sm">
									<span class="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/40"></span>
									<div class="min-w-0">
										<p class="truncate">{a.summary}</p>
										<p class="text-xs text-muted-foreground">{formatRelative(a.createdAt)}</p>
									</div>
								</li>
							{/each}
						</ul>
					{/if}
				</Card.Content>
			</Card.Root>

			<Card.Root>
				<Card.Header><Card.Title class="text-base">Newest customers</Card.Title></Card.Header>
				<Card.Content class="px-4">
					{#if d.recentCustomers.length === 0}
						<p class="py-4 text-sm text-muted-foreground">No customers yet.</p>
					{:else}
						<ul class="space-y-2">
							{#each d.recentCustomers as c (c.id)}
								<li class="flex items-center justify-between gap-2 text-sm">
									<a href="/customers/{c.id}" class="truncate hover:underline">{c.name}</a>
									<StatusBadge status={c.status} />
								</li>
							{/each}
						</ul>
					{/if}
				</Card.Content>
			</Card.Root>
		</div>
	</div>
</div>
