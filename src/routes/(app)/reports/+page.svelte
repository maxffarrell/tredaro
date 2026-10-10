<script lang="ts">
	import Users from '@lucide/svelte/icons/users';
	import Wallet from '@lucide/svelte/icons/wallet';
	import FileText from '@lucide/svelte/icons/file-text';
	import Clock from '@lucide/svelte/icons/clock';
	import Wrench from '@lucide/svelte/icons/wrench';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import PageHeader from '#lib/components/app/page-header.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { getReports } from '#lib/remote/workspace.remote.ts';
	import { getCurrency } from '#lib/remote/billing.remote.ts';
	import { formatDate, formatMoney } from '#lib/format.ts';
	import { BarChart } from 'layerchart';
	import * as Chart from '#lib/components/ui/chart/index.js';
	import Download from '@lucide/svelte/icons/download';

	const r = await getReports();
	const currency = await getCurrency();

	const jobsCfg = {
		count: { label: 'Jobs', theme: { light: '#2563eb', dark: '#60a5fa' } }
	} satisfies Chart.ChartConfig;
	const customersCfg = {
		count: { label: 'New customers', theme: { light: '#2563eb', dark: '#60a5fa' } }
	} satisfies Chart.ChartConfig;
	const revenueCfg = {
		total: { label: 'Collected', theme: { light: '#16a34a', dark: '#4ade80' } }
	} satisfies Chart.ChartConfig;
	const plansCfg = {
		count: { label: 'Agreements', theme: { light: '#2563eb', dark: '#60a5fa' } }
	} satisfies Chart.ChartConfig;
	const laborCfg = {
		approved: { label: 'Approved', theme: { light: '#059669', dark: '#34d399' } },
		pending: { label: 'Pending approval', theme: { light: '#d97706', dark: '#fbbf24' } }
	} satisfies Chart.ChartConfig;
	const utilCfg = {
		pct: { label: 'Capacity', theme: { light: '#2563eb', dark: '#60a5fa' } }
	} satisfies Chart.ChartConfig;
	const weekdayCfg = {
		cents: { label: 'Collected', theme: { light: '#2563eb', dark: '#60a5fa' } }
	} satisfies Chart.ChartConfig;
	const laborChart = r.labor.map((t) => ({
		name: t.name,
		approved: t.approvedMin,
		pending: Math.max(0, t.minutes - t.approvedMin)
	}));
	const decided = r.estimates.filter(
		(e) => e.status === 'approved' || e.status === 'declined' || e.status === 'converted'
	);
	const approved = r.estimates.filter((e) => e.status === 'approved' || e.status === 'converted');
	const reasonLabels: Record<string, string> = {
		price: 'Price too high',
		scope: "Scope doesn't fit",
		timing: "Timing isn't right",
		competitor: 'Went with another company',
		other: 'Other',
		unspecified: 'No reason given'
	};
	const avgSent = $derived.by(() => {
		const row = r.estimates.find((e) => e.status === 'sent');
		return row && row.count ? row.total / row.count : null;
	});
	const approvalRate = decided.length
		? Math.round(
				(approved.reduce((s, e) => s + e.count, 0) / decided.reduce((s, e) => s + e.count, 0)) * 100
			)
		: 0;

	function monthLabel(ym: string) {
		return new Date(`${ym}-02T00:00:00Z`).toLocaleString('en', { month: 'short', year: '2-digit' });
	}

	const fmtHours = (min: number) => {
		const m = Math.round(min);
		return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`;
	};
</script>

<PageHeader title="Reports">
	{#snippet actions()}
		<Button size="sm" variant="outline" href="/api/export/time-entries.csv" download
			><Download /> Time entries CSV</Button
		>
	{/snippet}
</PageHeader>

<div class="grid grid-cols-1 gap-6 p-4 md:p-6 lg:grid-cols-2">
	<Card.Root class="lg:col-span-2">
		<Card.Header>
			<Card.Title class="text-base">Completed jobs — last 30 days</Card.Title>
			<Card.Description>{r.completedJobs.reduce((s, d) => s + d.count, 0)} total</Card.Description>
		</Card.Header>
		<Card.Content>
			<Chart.Container config={jobsCfg} class="h-44 w-full">
				<BarChart
					data={r.completedJobs}
					x="day"
					series={[{ key: 'count', label: 'Jobs', color: 'var(--color-count)', value: 'count' }]}
					axis="x"
					props={{ xAxis: { format: (d: string) => formatDate(d, true) } }}
				/>
			</Chart.Container>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">New customers</Card.Title>
			<Card.Description>Per month, last 12 months</Card.Description>
		</Card.Header>
		<Card.Content>
			{#if r.customers.length}
				<Chart.Container config={customersCfg} class="h-44 w-full">
					<BarChart
						data={r.customers}
						x="month"
						series={[
							{
								key: 'count',
								label: 'New customers',
								color: 'var(--color-count)',
								value: 'count'
							}
						]}
						axis="x"
						props={{ xAxis: { format: (m: string) => monthLabel(m) } }}
					/>
				</Chart.Container>
			{:else}
				<Empty.Root class="border-0 py-4">
					<Empty.Header>
						<Empty.Media><Users /></Empty.Media>
						<Empty.Title class="text-sm">No customers yet</Empty.Title>
					</Empty.Header>
				</Empty.Root>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Revenue collected</Card.Title>
			<Card.Description>Payments per month, last 12 months</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-1.5">
			{#if r.revenue.length}
				<Chart.Container config={revenueCfg} class="h-44 w-full">
					<BarChart
						data={r.revenue}
						x="month"
						series={[
							{ key: 'total', label: 'Collected', color: 'var(--color-total)', value: 'total' }
						]}
						axis="x"
						props={{ xAxis: { format: (m: string) => monthLabel(m) } }}
					/>
				</Chart.Container>
			{:else}
				<Empty.Root class="border-0 py-4">
					<Empty.Header>
						<Empty.Media><Wallet /></Empty.Media>
						<Empty.Title class="text-sm">No payments yet</Empty.Title>
					</Empty.Header>
				</Empty.Root>
			{/if}
			{#if r.avgTicket != null}
				<p class="pt-2 text-sm text-muted-foreground">
					Avg invoice (90d): <span class="font-medium text-foreground"
						>{formatMoney(r.avgTicket, currency)}</span
					>
				</p>
			{/if}
			{#if r.avgDaysToInvoice != null}
				<p class="pt-1 text-sm text-muted-foreground">
					Avg days to invoice (90d): <span class="font-medium text-foreground"
						>{r.avgDaysToInvoice < 1 ? 'same day' : r.avgDaysToInvoice.toFixed(1) + ' days'}</span
					> after completion
				</p>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Agreements by plan</Card.Title>
			<Card.Description>Active agreements right now</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-1.5">
			{#if r.plans.length}
				<Chart.Container config={plansCfg} class="h-44 w-full">
					<BarChart
						data={r.plans}
						x="count"
						y="planName"
						orientation="horizontal"
						series={[
							{
								key: 'count',
								label: 'Agreements',
								color: 'var(--color-count)',
								value: 'count'
							}
						]}
					/>
				</Chart.Container>
			{:else}
				<Empty.Root class="border-0 py-4">
					<Empty.Header>
						<Empty.Media><FileText /></Empty.Media>
						<Empty.Title class="text-sm">No active agreements</Empty.Title>
					</Empty.Header>
				</Empty.Root>
			{/if}
			{#if r.churnedAgreements > 0}
				<p class="pt-2 text-sm text-muted-foreground">
					Cancelled in last 90d: <span class="font-medium text-foreground"
						>{r.churnedAgreements}</span
					>
				</p>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Estimate funnel</Card.Title>
			<Card.Description
				>{approvalRate}% approval on decided estimates{#if r.estimateDecisionDays != null}
					· avg {r.estimateDecisionDays.toFixed(1)}d to decision{/if}{#if avgSent != null}
					· avg {formatMoney(avgSent, currency, true)} per sent{/if}{#if r.avgItemsPerQuote}
					· avg {r.avgItemsPerQuote.toFixed(1)} items per quote{/if}</Card.Description
			>
		</Card.Header>
		<Card.Content class="overflow-x-auto px-0">
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
			<Card.Title class="text-base">Lost deals by reason</Card.Title>
			<Card.Description
				>Declined estimates by why the customer passed — picklist on the public quote page</Card.Description
			>
		</Card.Header>
		<Card.Content class="overflow-x-auto px-0">
			<Table.Root>
				<Table.Body>
					{#each r.lostByReason as l (l.reason)}
						<Table.Row>
							<Table.Cell class="pl-6 font-medium">{reasonLabels[l.reason] ?? l.reason}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{l.count}</Table.Cell>
							<Table.Cell class="pr-6 text-right text-muted-foreground tabular-nums"
								>{formatMoney(l.total, currency, true)}</Table.Cell
							>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell class="pl-6 text-muted-foreground">No declined estimates yet.</Table.Cell
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
			<Card.Description
				>Last 30 days, excluding cancelled{#if r.avgJobValue != null}
					· avg {formatMoney(r.avgJobValue, currency, true)} invoiced per job (90d){/if}{#if r.avgJobMinutes != null}
					· avg {fmtHours(r.avgJobMinutes)} per done job{/if}{#if r.cancelRate != null}
					· {Math.round(r.cancelRate)}% cancelled (30d){/if}</Card.Description
			>
		</Card.Header>
		<Card.Content class="overflow-x-auto px-0">
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
			<Card.Description
				>Last 30 days{#if r.repeatRate}
					· {r.repeatRate.repeats}/{r.repeatRate.customers} repeat customers (90d){/if}</Card.Description
			>
		</Card.Header>
		<Card.Content class="overflow-x-auto px-0">
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
			<Card.Title class="text-base">Warranty work</Card.Title>
			<Card.Description>No-charge visits under labor warranty — last 90 days</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-2 px-4">
			<div class="flex justify-between text-sm">
				<span class="text-muted-foreground">Warranty visits completed</span>
				<span class="tabular-nums">{r.warranty.count}</span>
			</div>
			<div class="flex justify-between text-sm">
				<span class="text-muted-foreground">Labor logged on warranty jobs</span>
				<span class="tabular-nums">{fmtHours(r.warranty.minutes)}</span>
			</div>
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
						<Table.Head class="text-right">Hrs/job</Table.Head>
						<Table.Head class="text-right">Collected</Table.Head>
						<Table.Head class="text-right">Commission</Table.Head>
						<Table.Head class="text-right">Rating</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each r.perf as t (t.memberId)}
						<Table.Row>
							<Table.Cell class="font-medium">{t.name}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{t.jobsDone}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{fmtHours(t.minutes)}</Table.Cell>
							<Table.Cell class="text-right tabular-nums"
								>{t.jobsDone ? fmtHours(t.avgMinPerJob) : '—'}</Table.Cell
							>
							<Table.Cell class="text-right tabular-nums"
								>{formatMoney(t.revenue, currency, true)}</Table.Cell
							>
							<Table.Cell class="text-right tabular-nums"
								>{t.commissionPct
									? `${formatMoney(t.commission, currency, true)} (${t.commissionPct}%)`
									: '—'}</Table.Cell
							>
							<Table.Cell class="text-right tabular-nums"
								>{t.avgRating ? `${t.avgRating.toFixed(1)}★` : '—'}</Table.Cell
							>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell colspan={7} class="text-muted-foreground"
								>No technician activity in the last 90 days.</Table.Cell
							></Table.Row
						>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>

	<Card.Root class="lg:col-span-2">
		<Card.Header>
			<Card.Title class="text-base">Job profitability</Card.Title>
			<Card.Description
				>Completed jobs, last 90 days — invoiced vs labor, materials, and expense cost{#if r.expenses90d}
					· {formatMoney(r.expenses90d, currency)} expenses logged (90d){/if}{#if r.materialsMargin}
					· materials margin {formatMoney(
						r.materialsMargin.sell - r.materialsMargin.cost,
						currency
					)} ({formatMoney(r.materialsMargin.sell, currency)} sell − {formatMoney(
						r.materialsMargin.cost,
						currency
					)} cost){/if}{#if r.profit.filter((j) => j.schedMin > 0 && j.billed > 0).length}
					· avg {formatMoney(
						r.profit.reduce((a, j) => a + j.billed, 0) /
							(r.profit.reduce((a, j) => a + j.schedMin, 0) / 60 || 1),
						currency
					)}/sched-hr{/if}</Card.Description
			>
		</Card.Header>
		<Card.Content>
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Job</Table.Head>
						<Table.Head>Customer</Table.Head>
						<Table.Head class="text-right">Labor</Table.Head>
						<Table.Head class="text-right">Labor cost</Table.Head>
						<Table.Head class="text-right">Materials</Table.Head>
						<Table.Head class="text-right">Expenses</Table.Head>
						<Table.Head class="text-right">Invoiced</Table.Head>
						<Table.Head class="text-right">Margin</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each r.profit as j (j.id)}
						<Table.Row>
							<Table.Cell class="font-medium"
								><a class="hover:underline" href="/jobs/{j.id}">J-{j.number}</a>
								{j.summary}</Table.Cell
							>
							<Table.Cell>{j.customerName}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{fmtHours(j.laborMin)}</Table.Cell>
							<Table.Cell class="text-right tabular-nums"
								>{formatMoney(j.laborCost, currency, true)}</Table.Cell
							>
							<Table.Cell class="text-right tabular-nums"
								>{formatMoney(j.matCost, currency, true)}</Table.Cell
							>
							<Table.Cell class="text-right tabular-nums"
								>{formatMoney(j.expCost, currency, true)}</Table.Cell
							>
							<Table.Cell class="text-right tabular-nums"
								>{formatMoney(j.billed, currency, true)}</Table.Cell
							>
							<Table.Cell
								class="text-right tabular-nums {j.billed - j.matCost - j.expCost - j.laborCost < 0
									? 'text-destructive'
									: ''}"
								>{formatMoney(
									j.billed - j.matCost - j.expCost - j.laborCost,
									currency,
									true
								)}</Table.Cell
							>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell colspan={8} class="text-muted-foreground"
								>No completed jobs in the last 90 days.</Table.Cell
							></Table.Row
						>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Receivables aging</Card.Title>
			<Card.Description>Open charge balances by days past due</Card.Description>
		</Card.Header>
		<Card.Content>
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Bucket</Table.Head>
						<Table.Head class="text-right">Charges</Table.Head>
						<Table.Head class="text-right">Balance</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each r.aging as a (a.bucket)}
						<Table.Row>
							<Table.Cell class="font-medium"
								>{a.bucket === 'current' ? 'Current / not due' : `${a.bucket} days`}</Table.Cell
							>
							<Table.Cell class="text-right tabular-nums">{a.count}</Table.Cell>
							<Table.Cell
								class="text-right tabular-nums {a.bucket !== 'current' && a.balance > 0
									? 'text-destructive'
									: ''}">{formatMoney(a.balance, currency, true)}</Table.Cell
							>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
			{#if r.daysToPay.n > 0}
				<p class="mt-3 text-sm text-muted-foreground">
					Avg days to pay (last 90d, settled invoices):
					<span class="font-medium text-foreground">{r.daysToPay.avgDays}</span> days across
					{r.daysToPay.n} invoice{r.daysToPay.n === 1 ? '' : 's'}
				</p>
			{/if}
			{#if r.openPOs.pos > 0}
				<p class="pt-1 text-sm text-muted-foreground">
					Open POs: <span class="font-medium text-foreground"
						>{formatMoney(r.openPOs.total, currency)}</span
					>
					across {r.openPOs.pos} purchase order{r.openPOs.pos === 1 ? '' : 's'}
				</p>
			{/if}
			{#if r.refunds < 0}
				<p class="pt-1 text-sm text-muted-foreground">
					Refunds issued (90d): <span class="font-medium text-foreground"
						>{formatMoney(r.refunds, currency)}</span
					>
				</p>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Leads by source</Card.Title>
			<Card.Description
				>Customers and revenue collected by where they came from — set a lead source on the customer
				record</Card.Description
			>
		</Card.Header>
		<Card.Content>
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Source</Table.Head>
						<Table.Head class="text-right">Customers</Table.Head>
						<Table.Head class="text-right">Collected</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each r.leads as l (l.source)}
						<Table.Row>
							<Table.Cell class="font-medium">{l.source}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{l.customers}</Table.Cell>
							<Table.Cell class="text-right tabular-nums"
								>{formatMoney(l.collected, currency, true)}</Table.Cell
							>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell colspan={3} class="text-muted-foreground">No customers yet.</Table.Cell
							></Table.Row
						>
					{/each}
				</Table.Body>
			</Table.Root>
			{#if r.revByCustomerType.length}
				<div class="mt-3 space-y-1.5">
					<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
						By customer type (90d)
					</p>
					{#each r.revByCustomerType as t (t.type)}
						<div class="flex items-center justify-between text-sm">
							<span class="capitalize">{t.type}</span>
							<span class="tabular-nums"
								>{formatMoney(t.total, currency, true)} · {t.n} customer{t.n === 1 ? '' : 's'}</span
							>
						</div>
					{/each}
				</div>
			{/if}
			{#if r.revByZip.length}
				<div class="mt-3 space-y-1.5">
					<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
						By service ZIP (90d)
					</p>
					{#each r.revByZip as z (z.zip)}
						<div class="flex items-center justify-between text-sm">
							<span class="tabular-nums">{z.zip}</span>
							<span class="tabular-nums"
								>{formatMoney(z.total, currency, true)} · {z.n} payment{z.n === 1 ? '' : 's'}</span
							>
						</div>
					{/each}
				</div>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Top customers</Card.Title>
			<Card.Description>Payments collected, last 12 months</Card.Description>
		</Card.Header>
		<Card.Content>
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Customer</Table.Head>
						<Table.Head class="text-right">Collected</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each r.topCustomers as cu (cu.id)}
						<Table.Row>
							<Table.Cell class="font-medium"
								><a class="hover:underline" href="/customers/{cu.id}">{cu.name}</a></Table.Cell
							>
							<Table.Cell class="text-right tabular-nums"
								>{formatMoney(cu.collected, currency, true)}</Table.Cell
							>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell colspan={2} class="text-muted-foreground"
								>No payments collected yet.</Table.Cell
							></Table.Row
						>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header class="flex-row items-start justify-between space-y-0">
			<div>
				<Card.Title class="text-base">Labor by technician</Card.Title>
				<Card.Description>
					Logged time, last 30 days — open timers count to now; green = approved for payroll
				</Card.Description>
			</div>
			<Button size="sm" variant="outline" href="/payroll">Payroll</Button>
		</Card.Header>
		<Card.Content class="space-y-1.5">
			{#if laborChart.length}
				<Chart.Container config={laborCfg} class="h-56 w-full">
					<BarChart
						data={laborChart}
						x={['approved', 'pending']}
						y="name"
						orientation="horizontal"
						series={[
							{
								key: 'approved',
								label: 'Approved',
								color: 'var(--color-approved)',
								value: 'approved'
							},
							{
								key: 'pending',
								label: 'Pending approval',
								color: 'var(--color-pending)',
								value: 'pending'
							}
						]}
						seriesLayout="stack"
						props={{ xAxis: { format: (m: number) => fmtHours(m) } }}
					/>
				</Chart.Container>
			{:else}
				<Empty.Root class="border-0 py-4">
					<Empty.Header>
						<Empty.Media><Clock /></Empty.Media>
						<Empty.Title class="text-sm">No time logged</Empty.Title>
						<Empty.Description>In the last 30 days.</Empty.Description>
					</Empty.Header>
				</Empty.Root>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Technician utilization</Card.Title>
			<Card.Description
				>Scheduled hours booked over the next 7 days vs an 8 hr/day capacity</Card.Description
			>
		</Card.Header>
		<Card.Content class="space-y-1.5">
			{#if r.utilization.length}
				<Chart.Container config={utilCfg} class="h-44 w-full">
					<BarChart
						data={r.utilization}
						x="pct"
						y="name"
						orientation="horizontal"
						series={[
							{
								key: 'pct',
								label: 'Capacity',
								value: 'pct'
							}
						]}
						c={(d: { pct: number }) => (d.pct > 100 ? 'over' : 'ok')}
						cDomain={['ok', 'over']}
						cRange={['var(--color-pct)', '#e11d48']}
					/>
				</Chart.Container>
			{:else}
				<Empty.Root class="border-0 py-4">
					<Empty.Header>
						<Empty.Media><Wrench /></Empty.Media>
						<Empty.Title class="text-sm">No technicians</Empty.Title>
					</Empty.Header>
				</Empty.Root>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Scheduled vs logged</Card.Title>
			<Card.Description
				>Last 30 days — hours on the schedule vs time entries; sorted by biggest gap</Card.Description
			>
		</Card.Header>
		<Card.Content class="overflow-x-auto px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Technician</Table.Head>
						<Table.Head class="text-right">Scheduled</Table.Head>
						<Table.Head class="text-right">Logged</Table.Head>
						<Table.Head class="text-right">Variance</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each r.variance as t (t.name)}
						<Table.Row>
							<Table.Cell class="font-medium">{t.name}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{t.schedH}h</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{t.loggedH}h</Table.Cell>
							<Table.Cell
								class="text-right tabular-nums {t.varianceH > 1
									? 'text-destructive'
									: t.varianceH < -1
										? 'text-amber-600 dark:text-amber-400'
										: 'text-muted-foreground'}"
								>{t.varianceH > 0 ? '+' : ''}{t.varianceH}h</Table.Cell
							>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell colspan={4} class="text-muted-foreground"
								>No scheduled or logged hours yet.</Table.Cell
							></Table.Row
						>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Office performance</Card.Title>
			<Card.Description>Jobs and revenue collected by office — all time</Card.Description>
		</Card.Header>
		<Card.Content class="overflow-x-auto px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Office</Table.Head>
						<Table.Head class="text-right">Jobs</Table.Head>
						<Table.Head class="text-right">Done</Table.Head>
						<Table.Head class="text-right">Collected</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each r.offices as o (o.id || 'unassigned')}
						<Table.Row>
							<Table.Cell class="font-medium">{o.name}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{o.jobs}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{o.done}</Table.Cell>
							<Table.Cell class="text-right tabular-nums"
								>{formatMoney(o.revenue, currency)}</Table.Cell
							>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell colspan={4} class="text-muted-foreground"
								>No offices or jobs yet.</Table.Cell
							></Table.Row
						>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Sales by job type</Card.Title>
			<Card.Description
				>Completed jobs and revenue collected by job type — all time</Card.Description
			>
		</Card.Header>
		<Card.Content class="overflow-x-auto px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Job type</Table.Head>
						<Table.Head class="text-right">Jobs done</Table.Head>
						<Table.Head class="text-right">Collected</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each r.salesByType as t (t.type)}
						<Table.Row>
							<Table.Cell class="font-medium">{t.type}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{t.jobs}</Table.Cell>
							<Table.Cell class="text-right tabular-nums"
								>{formatMoney(t.collected, currency)}</Table.Cell
							>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell colspan={3} class="text-muted-foreground"
								>No completed jobs yet.</Table.Cell
							></Table.Row
						>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>
	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Payments by method</Card.Title>
			<Card.Description
				>Collected revenue per payment method — all time{#if r.refunds}
					· {formatMoney(r.refunds, currency)} refunded in 90d{/if}</Card.Description
			>
		</Card.Header>
		<Card.Content class="overflow-x-auto px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Method</Table.Head>
						<Table.Head class="text-right">Payments</Table.Head>
						<Table.Head class="text-right">Collected</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each r.payMethods as m (m.method)}
						<Table.Row>
							<Table.Cell class="font-medium capitalize">{m.method}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{m.count}</Table.Cell>
							<Table.Cell class="text-right tabular-nums"
								>{formatMoney(m.total, currency)}</Table.Cell
							>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell colspan={3} class="text-muted-foreground"
								>No payments recorded yet.</Table.Cell
							></Table.Row
						>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header><Card.Title class="text-base">Jobs by source</Card.Title></Card.Header>
		<Card.Content class="overflow-x-auto px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Source</Table.Head>
						<Table.Head class="text-right">Jobs</Table.Head>
						<Table.Head class="text-right">Completed</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each r.jobSources as j (j.source)}
						<Table.Row>
							<Table.Cell class="font-medium capitalize">{j.source.replace('_', ' ')}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{j.count}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{j.done}</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell colspan={3} class="text-muted-foreground">No jobs yet.</Table.Cell
							></Table.Row
						>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header
			><Card.Title class="text-base">Completion rate — last 90 days</Card.Title></Card.Header
		>
		<Card.Content class="overflow-x-auto px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Outcome</Table.Head>
						<Table.Head class="text-right">Jobs</Table.Head>
						<Table.Head class="text-right">%</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					<Table.Row>
						<Table.Cell class="font-medium">Completed</Table.Cell>
						<Table.Cell class="text-right tabular-nums">{r.completion.done}</Table.Cell>
						<Table.Cell class="text-right tabular-nums"
							>{r.completion.total
								? Math.round((r.completion.done / r.completion.total) * 100)
								: 0}%</Table.Cell
						>
					</Table.Row>
					<Table.Row>
						<Table.Cell class="font-medium">Cancelled</Table.Cell>
						<Table.Cell class="text-right tabular-nums">{r.completion.cancelled}</Table.Cell>
						<Table.Cell class="text-right tabular-nums"
							>{r.completion.total
								? Math.round((r.completion.cancelled / r.completion.total) * 100)
								: 0}%</Table.Cell
						>
					</Table.Row>
					<Table.Row>
						<Table.Cell class="font-medium">No-show</Table.Cell>
						<Table.Cell class="text-right tabular-nums">{r.completion.noShow}</Table.Cell>
						<Table.Cell class="text-right tabular-nums"
							>{r.completion.total
								? Math.round((r.completion.noShow / r.completion.total) * 100)
								: 0}%</Table.Cell
						>
					</Table.Row>
					<Table.Row>
						<Table.Cell class="font-medium text-muted-foreground">All jobs</Table.Cell>
						<Table.Cell class="text-right text-muted-foreground tabular-nums"
							>{r.completion.total}</Table.Cell
						>
						<Table.Cell class="text-right text-muted-foreground tabular-nums">100%</Table.Cell>
					</Table.Row>
				</Table.Body>
			</Table.Root>
			{#if r.completion.avgDaysToComplete != null}
				<p class="px-6 pt-2 text-sm text-muted-foreground">
					Avg time to complete: <span class="font-medium text-foreground"
						>{r.completion.avgDaysToComplete < 1
							? 'same day'
							: `${r.completion.avgDaysToComplete.toFixed(1)} days`}</span
					>
				</p>
			{/if}
		</Card.Content>
	</Card.Root>

	{#if r.ratings.n}
		<Card.Root>
			<Card.Header
				><Card.Title class="text-base">Visit ratings — last 90 days</Card.Title></Card.Header
			>
			<Card.Content>
				<p class="text-3xl font-semibold tabular-nums">
					{r.ratings.avg?.toFixed(1)}<span class="text-base text-muted-foreground">/5</span>
				</p>
				<p class="text-sm text-muted-foreground">
					{r.ratings.n} rating{r.ratings.n === 1 ? '' : 's'} from customers{#if r.ratings.low}
						· <span class="text-amber-600 dark:text-amber-400"
							>{r.ratings.low} at 3 stars or less</span
						>{/if}
				</p>
			</Card.Content>
		</Card.Root>
	{/if}

	{#if r.estAccuracy.count}
		<Card.Root>
			<Card.Header
				><Card.Title class="text-base">Estimate accuracy — converted quotes</Card.Title
				></Card.Header
			>
			<Card.Content>
				{#if r.estAccuracy.avgVariancePct != null}
					<p class="text-3xl font-semibold tabular-nums">
						{r.estAccuracy.avgVariancePct > 0 ? '+' : ''}{r.estAccuracy.avgVariancePct}%
					</p>
					<p class="text-sm text-muted-foreground">
						avg invoiced vs quoted across {r.estAccuracy.count} converted estimate{r.estAccuracy
							.count === 1
							? ''
							: 's'} — positive means billed over quote
					</p>
				{:else}
					<p class="text-sm text-muted-foreground">
						{r.estAccuracy.count} converted estimate{r.estAccuracy.count === 1 ? '' : 's'} — no quoted
						totals to compare yet
					</p>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}

	{#if r.callbacks.done}
		<Card.Root>
			<Card.Header
				><Card.Title class="text-base">Callback rate — last 12 months</Card.Title></Card.Header
			>
			<Card.Content>
				<p class="text-3xl font-semibold tabular-nums">{r.callbacks.pct}%</p>
				<p class="text-sm text-muted-foreground">
					{r.callbacks.callbacks} of {r.callbacks.done} done jobs revisited the same location within 30
					days — a rework proxy (lower is better)
				</p>
			</Card.Content>
		</Card.Root>
	{/if}

	{#if r.revWeekday.some((d) => d.cents > 0)}
		<Card.Root>
			<Card.Header><Card.Title class="text-base">Collected by weekday</Card.Title></Card.Header>
			<Card.Content>
				<Chart.Container config={weekdayCfg} class="h-44 w-full">
					<BarChart
						data={r.revWeekday}
						x="label"
						series={[
							{ key: 'cents', label: 'Collected', color: 'var(--color-cents)', value: 'cents' }
						]}
						props={{
							yAxis: { format: (c: number) => formatMoney(c, currency, true) }
						}}
					/>
				</Chart.Container>
			</Card.Content>
		</Card.Root>
	{/if}

	{#if r.topMaterials.length}
		<Card.Root>
			<Card.Header
				><Card.Title class="text-base">Top materials used — last 90 days</Card.Title></Card.Header
			>
			<Card.Content class="overflow-x-auto px-0">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head class="pl-6">Item</Table.Head>
							<Table.Head class="text-right">Qty used</Table.Head>
							<Table.Head class="pr-6 text-right">Jobs</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each r.topMaterials as m (m.name)}
							<Table.Row>
								<Table.Cell class="pl-6 font-medium">{m.name}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{m.qty} {m.unit}</Table.Cell>
								<Table.Cell class="pr-6 text-right tabular-nums">{m.jobs}</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>
	{/if}
</div>
