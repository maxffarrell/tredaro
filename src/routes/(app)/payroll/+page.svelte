<script lang="ts">
	import * as Empty from '#lib/components/ui/empty/index.js';
	import PageHeader from '#lib/components/app/page-header.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { approveMemberEntries, approveTimeEntry, getPayroll } from '#lib/remote/jobs.remote.ts';
	import { getSettings } from '#lib/remote/workspace.remote.ts';
	import { addDays, localDate, localTime } from '#lib/tz.ts';
	import { SvelteMap } from 'svelte/reactivity';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { errMsg, formatMoney } from '#lib/format.ts';
	import Download from '@lucide/svelte/icons/download';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Timer from '@lucide/svelte/icons/timer';

	const settings = await getSettings();
	const tz = settings.timezone;
	const todayStr = localDate(new Date(), tz);
	// Week containing `from`, Monday start.
	const mondayOf = (day: string) => {
		const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
		return addDays(day, -((dow + 6) % 7));
	};
	let start = $state(mondayOf(page.url.searchParams.get('from') ?? todayStr));
	let end = $state(addDays(start, 6));
	const span = $derived(
		Math.round(
			(new Date(`${end}T12:00:00Z`).getTime() - new Date(`${start}T12:00:00Z`).getTime()) / 86400000
		) + 1
	);
	const thisWeek = $derived(start === mondayOf(todayStr) && end === addDays(start, 6));

	const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
	const thisMonthEnd = addDays(monthStart(addDays(monthStart(todayStr), 32)), -1);
	const lastMonthStart = monthStart(addDays(monthStart(todayStr), -1));
	const presets = [
		{ label: 'This week', from: mondayOf(todayStr), to: addDays(mondayOf(todayStr), 6) },
		{
			label: 'Last week',
			from: addDays(mondayOf(todayStr), -7),
			to: addDays(mondayOf(todayStr), -1)
		},
		{ label: 'This month', from: monthStart(todayStr), to: thisMonthEnd },
		{ label: 'Last month', from: lastMonthStart, to: addDays(monthStart(todayStr), -1) }
	];
	const pick = (from: string, to: string) => {
		start = from;
		end = to;
		goto(`?from=${start}`, { replaceState: true });
	};

	const rows = $derived(await getPayroll({ from: start, to: end }));

	const groups = $derived.by(() => {
		const map = new SvelteMap<string | null, { name: string; rows: typeof rows }>();
		for (const r of rows) {
			const key = r.entry.memberId;
			if (!map.has(key)) map.set(key, { name: r.memberName ?? 'Former member', rows: [] });
			map.get(key)!.rows.push(r);
		}
		return [...map.entries()];
	});

	const minutesOf = (e: { startedAt: Date; endedAt: Date | null }) =>
		Math.max(0, Math.round(((e.endedAt ?? new Date()).getTime() - e.startedAt.getTime()) / 60000));
	const fmtDur = (min: number) => {
		const m = Math.round(min);
		return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`;
	};
	const sumMin = (list: typeof rows) => list.reduce((s, r) => s + minutesOf(r.entry), 0);
	const pendingCount = (list: typeof rows) =>
		list.filter((r) => r.entry.endedAt && !r.entry.approvedAt).length;

	const totalMin = $derived(sumMin(rows));
	const approvedMin = $derived(
		rows.filter((r) => r.entry.approvedAt).reduce((s, r) => s + minutesOf(r.entry), 0)
	);
	// Estimated labor cost for a set of rows — member loaded rate × minutes.
	const costOf = (list: typeof rows) =>
		list.reduce(
			(s, r) => s + (r.laborCostCents ? (minutesOf(r.entry) / 60) * r.laborCostCents : 0),
			0
		);
	const totalCost = $derived(costOf(rows));

	let busy = $state(false);
	async function approveMember(memberId: string) {
		busy = true;
		try {
			const r = await approveMemberEntries({ memberId, from: start, to: end }).updates(getPayroll);
			toast.success(`${r.approved} entr${r.approved === 1 ? 'y' : 'ies'} approved`);
		} catch (err) {
			toast.error(errMsg(err, 'Could not approve'));
		}
		busy = false;
	}

	async function toggle(entryId: string, approved: boolean) {
		try {
			await approveTimeEntry({ id: entryId, approved }).updates(getPayroll);
		} catch (err) {
			toast.error(errMsg(err, 'Could not update entry'));
		}
	}
</script>

<PageHeader title="Payroll" crumbs={[{ label: 'Reports', href: '/reports' }]}>
	{#snippet actions()}
		<div class="flex items-center gap-1">
			<Button
				size="icon"
				variant="ghost"
				aria-label="Previous week"
				onclick={() => pick(addDays(start, -span), addDays(end, -span))}><ChevronLeft /></Button
			>
			<Button
				size="sm"
				variant="outline"
				disabled={thisWeek}
				onclick={() => pick(mondayOf(todayStr), addDays(mondayOf(todayStr), 6))}>This week</Button
			>
			<Button
				size="icon"
				variant="ghost"
				aria-label="Next week"
				onclick={() => pick(addDays(start, span), addDays(end, span))}><ChevronRight /></Button
			>
			<Button size="sm" variant="outline" href="/api/export/payroll.csv?from={start}&to={end}"
				><Download /> Export</Button
			>
		</div>
	{/snippet}
</PageHeader>

<div class="space-y-4 p-4">
	<div class="flex flex-wrap items-center gap-2">
		<Badge variant="secondary" class="font-normal"
			>{new Date(`${start}T12:00:00Z`).toLocaleDateString('en-US', {
				month: 'short',
				day: 'numeric',
				timeZone: 'UTC'
			})} – {new Date(`${end}T12:00:00Z`).toLocaleDateString('en-US', {
				month: 'short',
				day: 'numeric',
				timeZone: 'UTC'
			})}</Badge
		>
		{#if rows.length}
			<Badge variant="outline" class="font-normal">{fmtDur(totalMin)} logged</Badge>
			<Badge variant="outline" class="font-normal text-emerald-600 dark:text-emerald-400"
				>{fmtDur(approvedMin)} approved</Badge
			>
			{#if totalCost > 0}
				<Badge variant="outline" class="font-normal"
					>≈ {formatMoney(totalCost, settings.currency, true)} est. labor</Badge
				>
			{/if}
		{/if}
		<span class="w-full sm:hidden"></span>
		{#each presets as p (p.label)}
			<Button
				size="sm"
				variant={start === p.from && end === p.to ? 'secondary' : 'ghost'}
				class="h-7 px-2 text-xs"
				onclick={() => pick(p.from, p.to)}>{p.label}</Button
			>
		{/each}
	</div>

	{#if !rows.length}
		<Empty.Root class="border">
			<Empty.Header>
				<Empty.Media><Timer /></Empty.Media>
				<Empty.Title>No time logged this week</Empty.Title>
				<Empty.Description>Entries from My Day and job timers appear here.</Empty.Description>
			</Empty.Header>
		</Empty.Root>
	{/if}

	{#each groups as [memberId, g] (memberId ?? 'former')}
		{@const pending = pendingCount(g.rows)}
		<Card.Root>
			<Card.Header class="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
				<Card.Title class="text-base">{g.name}</Card.Title>
				<div class="flex items-center gap-2">
					<Badge variant="outline" class="font-normal">{fmtDur(sumMin(g.rows))}</Badge>
					{#if costOf(g.rows) > 0}
						<Badge
							variant="outline"
							class="font-normal"
							title="Estimated labor cost at this member's loaded rate"
							>≈ {formatMoney(costOf(g.rows), settings.currency, true)}</Badge
						>
					{/if}
					{#if sumMin(g.rows) > 40 * 60}
						<Badge
							variant="outline"
							class="border-amber-300 font-normal text-amber-700 dark:text-amber-400"
							title="{fmtDur(sumMin(g.rows) - 40 * 60)} over a 40-hour week">OT</Badge
						>
					{/if}
					{#if pending > 0 && memberId}
						<Button
							size="sm"
							variant="outline"
							class="h-7 text-xs"
							disabled={busy}
							onclick={() => approveMember(memberId)}>Approve {pending}</Button
						>
					{/if}
				</div>
			</Card.Header>
			<Card.Content class="px-4">
				<ul class="divide-y">
					{#each g.rows as r (r.entry.id)}
						<li class="flex items-center gap-3 py-2 text-sm">
							<div class="min-w-0 flex-1">
								<p>
									<a href="/jobs/{r.jobId}" class="font-medium hover:underline">J-{r.jobNumber}</a>
									<span class="text-muted-foreground">
										· {r.customerName ?? ''}{r.jobSummary ? ` · ${r.jobSummary}` : ''}</span
									>
								</p>
								<p class="text-xs text-muted-foreground">
									{localDate(r.entry.startedAt, tz)}
									{localTime(r.entry.startedAt, tz)}
									{#if r.entry.endedAt}– {localTime(r.entry.endedAt, tz)}{:else}– running{/if}
									{#if r.entry.note}
										· {r.entry.note}{/if}
									{#if r.entry.approvedAt && r.approvedByName}
										· approved by {r.approvedByName}{/if}
								</p>
							</div>
							<span class="shrink-0 text-muted-foreground tabular-nums"
								>{fmtDur(minutesOf(r.entry))}</span
							>
							{#if r.entry.endedAt}
								<Button
									variant="ghost"
									size="icon"
									class="size-7 {r.entry.approvedAt
										? 'text-emerald-600 dark:text-emerald-400'
										: 'text-muted-foreground'}"
									aria-label={r.entry.approvedAt ? 'Unapprove entry' : 'Approve entry'}
									title={r.entry.approvedAt
										? 'Approved — click to unapprove'
										: 'Approve for payroll'}
									onclick={() => toggle(r.entry.id, !r.entry.approvedAt)}
								>
									<CircleCheck class="size-3.5" />
								</Button>
							{/if}
						</li>
					{/each}
				</ul>
			</Card.Content>
		</Card.Root>
	{/each}
</div>
