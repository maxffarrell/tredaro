<script lang="ts">
	import PageHeader from '#lib/components/app/page-header.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { getReports } from '#lib/remote/workspace.remote.ts';
	import { getCurrency } from '#lib/remote/billing.remote.ts';
	import { formatDate, formatMoney } from '#lib/format.ts';
	import Download from '@lucide/svelte/icons/download';

	const r = await getReports();
	const currency = await getCurrency();

	const maxJobs = Math.max(1, ...r.completedJobs.map((d) => d.count));
	const maxCustomers = Math.max(1, ...r.customers.map((m) => m.count));
	const maxRevenue = Math.max(1, ...r.revenue.map((m) => m.total));
	const maxPlan = Math.max(1, ...r.plans.map((p) => p.count));
	const decided = r.estimates.filter(
		(e) => e.status === 'approved' || e.status === 'declined' || e.status === 'converted'
	);
	const approved = r.estimates.filter((e) => e.status === 'approved' || e.status === 'converted');
	const approvalRate = decided.length
		? Math.round(
				(approved.reduce((s, e) => s + e.count, 0) / decided.reduce((s, e) => s + e.count, 0)) * 100
			)
		: 0;

	function monthLabel(ym: string) {
		return new Date(`${ym}-02T00:00:00Z`).toLocaleString('en', { month: 'short', year: '2-digit' });
	}

	const fmtHours = (min: number) =>
		min >= 60
			? `${Math.floor(min / 60)}h${min % 60 ? ` ${Math.round(min % 60)}m` : ''}`
			: `${Math.round(min)}m`;
	const maxLabor = Math.max(1, ...r.labor.map((l) => l.minutes));
</script>

<PageHeader title="Reports">
	{#snippet actions()}
		<Button size="sm" variant="outline" href="/api/export/time-entries.csv" download
			><Download /> Time entries CSV</Button
		>
	{/snippet}
</PageHeader>

<div class="grid gap-6 p-4 md:p-6 lg:grid-cols-2">
	<Card.Root class="lg:col-span-2">
		<Card.Header>
			<Card.Title class="text-base">Completed jobs — last 30 days</Card.Title>
			<Card.Description>{r.completedJobs.reduce((s, d) => s + d.count, 0)} total</Card.Description>
		</Card.Header>
		<Card.Content>
			<div class="flex h-32 items-end gap-px">
				{#each r.completedJobs as d (d.day)}
					<div
						class="flex-1 rounded-t bg-primary/80"
						style="height: {Math.max(2, (d.count / maxJobs) * 100)}%"
						title="{formatDate(d.day)} — {d.count}"
					></div>
				{/each}
			</div>
			<div class="mt-1 flex justify-between text-xs text-muted-foreground">
				<span>{formatDate(r.completedJobs[0]!.day)}</span>
				<span>{formatDate(r.completedJobs.at(-1)!.day)}</span>
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">New customers</Card.Title>
			<Card.Description>Per month, last 12 months</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-1.5">
			{#each r.customers as m (m.month)}
				<div class="flex items-center gap-2 text-sm">
					<span class="w-14 shrink-0 text-muted-foreground">{monthLabel(m.month)}</span>
					<div
						class="h-4 rounded bg-primary/70"
						style="width: {(m.count / maxCustomers) * 70}%"
					></div>
					<span class="tabular-nums">{m.count}</span>
				</div>
			{:else}
				<p class="text-sm text-muted-foreground">No customers yet.</p>
			{/each}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Revenue collected</Card.Title>
			<Card.Description>Payments per month, last 12 months</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-1.5">
			{#each r.revenue as m (m.month)}
				<div class="flex items-center gap-2 text-sm">
					<span class="w-14 shrink-0 text-muted-foreground">{monthLabel(m.month)}</span>
					<div
						class="h-4 rounded bg-green-500/70"
						style="width: {(m.total / maxRevenue) * 70}%"
					></div>
					<span class="tabular-nums">{formatMoney(m.total, currency, true)}</span>
				</div>
			{:else}
				<p class="text-sm text-muted-foreground">No payments yet.</p>
			{/each}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Agreements by plan</Card.Title>
			<Card.Description>Active agreements right now</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-1.5">
			{#each r.plans as p (p.planName)}
				<div class="flex items-center gap-2 text-sm">
					<span class="w-32 shrink-0 truncate">{p.planName}</span>
					<div class="h-4 rounded bg-primary/70" style="width: {(p.count / maxPlan) * 70}%"></div>
					<span class="tabular-nums">{p.count}</span>
				</div>
			{:else}
				<p class="text-sm text-muted-foreground">No active agreements.</p>
			{/each}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Estimate funnel</Card.Title>
			<Card.Description>{approvalRate}% approval on decided estimates</Card.Description>
		</Card.Header>
		<Card.Content class="px-0">
			<Table.Root>
				<Table.Body>
					{#each r.estimates as e (e.status)}
						<Table.Row>
							<Table.Cell class="pl-6"><StatusBadge status={e.status} /></Table.Cell>
							<Table.Cell class="text-right tabular-nums">{e.count}</Table.Cell>
							<Table.Cell class="pr-6 text-right text-muted-foreground tabular-nums"
								>{formatMoney(e.total, currency, true)}</Table.Cell
							>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell class="pl-6 text-muted-foreground">No estimates yet.</Table.Cell
							></Table.Row
						>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Jobs by type</Card.Title>
			<Card.Description>Last 30 days, excluding cancelled</Card.Description>
		</Card.Header>
		<Card.Content class="px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Job type</Table.Head>
						<Table.Head class="text-right">Jobs</Table.Head>
						<Table.Head class="text-right">Done</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each r.byType as t (t.typeName)}
						<Table.Row>
							<Table.Cell class="font-medium">
								<span class="mr-2 inline-block size-2 rounded-full" style:background={t.color}
								></span>{t.typeName}
							</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{t.jobs}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{t.done}</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell colspan={3} class="text-muted-foreground"
								>No jobs in the last 30 days.</Table.Cell
							></Table.Row
						>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Technician workload</Card.Title>
			<Card.Description>Last 30 days</Card.Description>
		</Card.Header>
		<Card.Content class="px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Technician</Table.Head>
						<Table.Head class="text-right">Assigned</Table.Head>
						<Table.Head class="text-right">Completed</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each r.techs as t (t.name)}
						<Table.Row>
							<Table.Cell class="font-medium">{t.name}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{t.jobs}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{t.done}</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell colspan={3} class="text-muted-foreground"
								>No assigned jobs in the last 30 days.</Table.Cell
							></Table.Row
						>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Technician performance</Card.Title>
			<Card.Description
				>Jobs completed, hours logged, revenue collected on their jobs — last 90 days</Card.Description
			>
		</Card.Header>
		<Card.Content>
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Technician</Table.Head>
						<Table.Head class="text-right">Jobs done</Table.Head>
						<Table.Head class="text-right">Hours</Table.Head>
						<Table.Head class="text-right">Collected</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each r.perf as t (t.memberId)}
						<Table.Row>
							<Table.Cell class="font-medium">{t.name}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{t.jobsDone}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{fmtHours(t.minutes)}</Table.Cell>
							<Table.Cell class="text-right tabular-nums"
								>{formatMoney(t.revenue, currency, true)}</Table.Cell
							>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell colspan={4} class="text-muted-foreground"
								>No technician activity in the last 90 days.</Table.Cell
							></Table.Row
						>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Labor by technician</Card.Title>
			<Card.Description>Logged time, last 30 days — open timers count to now</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-1.5">
			{#each r.labor as t (t.memberId)}
				<div class="flex items-center gap-2 text-sm">
					<span class="w-32 shrink-0 truncate">{t.name}</span>
					<div
						class="h-4 rounded bg-primary/70"
						style="width: {(t.minutes / maxLabor) * 70}%"
					></div>
					<span class="tabular-nums"
						>{fmtHours(t.minutes)}{#if t.open}
							<span class="text-muted-foreground"> + running</span>{/if}</span
					>
				</div>
			{:else}
				<p class="text-sm text-muted-foreground">No time logged in the last 30 days.</p>
			{/each}
		</Card.Content>
	</Card.Root>
</div>
