<script lang="ts">
	import { page } from '$app/state';
	import PageHeader from '#lib/components/app/page-header.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import EllipsisVertical from '@lucide/svelte/icons/ellipsis-vertical';
	import FileText from '@lucide/svelte/icons/file-text';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import { toast } from 'svelte-sonner';
	import {
		getMemberProfile,
		getJobTypes,
		removeMemberDoc,
		setMemberDocExpiry
	} from '#lib/remote/jobs.remote.ts';
	import { getSettings } from '#lib/remote/workspace.remote.ts';
	import { errMsg, formatDate, formatMoney, formatRelative } from '#lib/format.ts';
	import { localTime } from '#lib/tz.ts';

	const id = $derived(page.params.id!);
	const p = $derived(await getMemberProfile(id));
	const settings = $derived(await getSettings());
	const jobTypes = $derived(await getJobTypes());
	const currency = $derived(settings.currency);
	const tz = $derived(settings.timezone);
	const skillNames = $derived(
		(p.member.skillTags || '')
			.split(',')
			.filter(Boolean)
			.map((tid) => jobTypes.find((t) => t.id === tid)?.name ?? tid)
	);
	const fmtHours = (min: number) => {
		const m = Math.round(min);
		return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`;
	};
	const entryMin = (e: {
		startedAt: string | Date;
		endedAt: string | Date | null;
		breakMin: number;
	}) =>
		Math.max(
			0,
			Math.round(
				((e.endedAt ? new Date(e.endedAt) : new Date()).getTime() -
					new Date(e.startedAt).getTime()) /
					60000 -
					e.breakMin
			)
		);
	const todayStr = $derived(new Date().toISOString().slice(0, 10));

	let docUploading = $state(false);
	let docLabel = $state('');
	async function uploadDoc(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		docUploading = true;
		try {
			const form = new FormData();
			form.set('file', file);
			if (docLabel.trim()) form.set('label', docLabel.trim());
			const res = await fetch(`/api/team/${id}/documents`, { method: 'POST', body: form });
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				throw new Error(body?.message ?? `Upload failed (${res.status})`);
			}
			await getMemberProfile(id).refresh();
			docLabel = '';
			toast.success('Document added');
		} catch (err) {
			toast.error(errMsg(err, 'Could not upload document'));
		}
		input.value = '';
		docUploading = false;
	}

	let expDocId = $state('');
	let expDate = $state('');
	let expOpen = $state(false);
	function openDocExpiry(d: { id: string; expiresOn: string | null }) {
		expDocId = d.id;
		expDate = d.expiresOn ?? '';
		expOpen = true;
	}
	async function saveDocExpiry() {
		try {
			await setMemberDocExpiry({ id: expDocId, memberId: id, expiresOn: expDate || null });
			expOpen = false;
			toast.success('Expiry updated');
		} catch (err) {
			toast.error(errMsg(err, 'Could not set expiry'));
		}
	}
	function docExpiryTone(expiresOn: string | null) {
		if (!expiresOn) return '';
		const days = Math.floor(
			(new Date(`${expiresOn}T12:00:00Z`).getTime() - Date.now()) / 86_400_000
		);
		return days < 0
			? 'text-red-600 dark:text-red-400'
			: days <= 30
				? 'text-amber-600 dark:text-amber-400'
				: '';
	}
	function docSize(bytes: number) {
		return bytes >= 1_048_576
			? `${(bytes / 1_048_576).toFixed(1)} MB`
			: `${Math.max(1, Math.round(bytes / 1024))} KB`;
	}
</script>

<PageHeader title={p.member.name} crumbs={[{ label: 'Team', href: '/settings' }]}>
	{#snippet actions()}
		{#if p.member.color}
			<span
				class="size-4 rounded-full border"
				style="background:{p.member.color}"
				title="Dispatch color"
			></span>
		{/if}
		<Badge
			variant={p.member.role === 'owner' || p.member.role === 'admin' ? 'default' : 'secondary'}
			>{p.member.role}</Badge
		>
	{/snippet}
</PageHeader>

<div class="grid grid-cols-1 gap-6 p-4 md:p-6 xl:grid-cols-3">
	<div class="space-y-6">
		<Card.Root>
			<Card.Header><Card.Title class="text-base">Profile</Card.Title></Card.Header>
			<Card.Content class="space-y-2 text-sm">
				<div class="flex justify-between gap-2">
					<span class="text-muted-foreground">Email</span><span class="truncate"
						>{p.member.email}</span
					>
				</div>
				{#if p.member.phone}
					<div class="flex justify-between gap-2">
						<span class="text-muted-foreground">SMS</span><span>{p.member.phone}</span>
					</div>
				{/if}
				<div class="flex justify-between gap-2">
					<span class="text-muted-foreground">Member since</span><span
						>{formatDate(p.member.createdAt)}</span
					>
				</div>
				<div class="flex justify-between gap-2">
					<span class="text-muted-foreground">Commission</span><span class="tabular-nums"
						>{p.member.commissionPct}%</span
					>
				</div>
				<div class="flex justify-between gap-2">
					<span class="text-muted-foreground">Loaded labor cost</span><span class="tabular-nums"
						>{formatMoney(p.member.laborCostCents, currency)}/hr · OT {p.member.overtimePct}%</span
					>
				</div>
				{#if p.member.licenseNo || p.member.licenseExpiry}
					<div class="flex justify-between gap-2">
						<span class="text-muted-foreground">License</span>
						<span class="flex items-center gap-1"
							>{p.member.licenseNo || '—'}
							{#if p.member.licenseExpiry}
								<Badge
									variant={p.member.licenseExpiry < todayStr ? 'destructive' : 'secondary'}
									class="font-normal">{p.member.licenseExpiry}</Badge
								>
							{/if}
						</span>
					</div>
				{/if}
				<div class="flex justify-between gap-2">
					<span class="text-muted-foreground">Dispatch board</span><span
						>{p.member.dispatchVisible ? 'visible' : 'hidden'}</span
					>
				</div>
				<div class="flex justify-between gap-2">
					<span class="text-muted-foreground">Staff alerts</span><span
						>{p.member.staffAlerts ? 'on' : 'off'}</span
					>
				</div>
				{#if skillNames.length}
					<div>
						<p class="mb-1 text-muted-foreground">Qualified job types</p>
						<div class="flex flex-wrap gap-1">
							{#each skillNames as n (n)}<Badge variant="outline" class="font-normal">{n}</Badge
								>{/each}
						</div>
					</div>
				{:else}
					<p class="text-muted-foreground">Qualified for all job types</p>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header><Card.Title class="text-base">Last 30 days</Card.Title></Card.Header>
			<Card.Content>
				<div class="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
					<div>
						<p class="text-2xl font-semibold tabular-nums">{fmtHours(p.minutes30)}</p>
						<p class="text-xs text-muted-foreground">logged</p>
					</div>
					<div>
						<p class="text-2xl font-semibold tabular-nums">{p.done30}</p>
						<p class="text-xs text-muted-foreground">jobs done</p>
					</div>
					<div>
						<p class="text-2xl font-semibold tabular-nums">
							{p.avgRating != null ? p.avgRating.toFixed(1) : '—'}
						</p>
						<p class="text-xs text-muted-foreground">avg rating ({p.ratingCount})</p>
					</div>
					<div>
						<p class="text-2xl font-semibold tabular-nums">
							{formatMoney(p.tips30.total, currency)}
						</p>
						<p class="text-xs text-muted-foreground">tips ({p.tips30.n})</p>
					</div>
				</div>
			</Card.Content>
		</Card.Root>

		{#if p.timeOff.length}
			<Card.Root>
				<Card.Header><Card.Title class="text-base">Upcoming time off</Card.Title></Card.Header>
				<Card.Content class="space-y-2 text-sm">
					{#each p.timeOff as t (t.id)}
						<div class="flex items-center justify-between gap-2">
							<span>{formatDate(t.startsOn)} → {formatDate(t.endsOn)}</span>
							<Badge
								variant={t.status === 'approved'
									? 'secondary'
									: t.status === 'denied'
										? 'destructive'
										: 'outline'}
								class="font-normal">{t.status}</Badge
							>
						</div>
						{#if t.reason}<p class="text-xs text-muted-foreground">{t.reason}</p>{/if}
					{/each}
				</Card.Content>
			</Card.Root>
		{/if}

		<Card.Root>
			<Card.Header class="flex-row items-center justify-between gap-2">
				<Card.Title class="text-base"
					>Documents{#if p.documents.length}
						<span class="ml-1 text-xs font-normal text-muted-foreground"
							>({p.documents.length})</span
						>{/if}</Card.Title
				>
				<div class="flex items-center gap-2">
					<Input class="h-8 w-28 text-xs" placeholder="Label" bind:value={docLabel} />
					<label
						class="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition-colors hover:bg-accent {docUploading
							? 'pointer-events-none opacity-60'
							: ''}"
					>
						<Paperclip class="size-4" />
						{docUploading ? 'Uploading…' : 'Upload'}
						<input type="file" class="sr-only" disabled={docUploading} onchange={uploadDoc} />
					</label>
				</div>
			</Card.Header>
			<Card.Content class="space-y-2 px-4">
				{#each p.documents as d (d.id)}
					<div class="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm">
						<div class="flex min-w-0 flex-1 items-center gap-2">
							<FileText class="size-4 shrink-0 text-muted-foreground" />
							<div class="min-w-0">
								<a
									href="/files/member-document/{d.id}"
									target="_blank"
									class="block truncate font-medium hover:underline"
									>{#if d.label}{d.label} ·
									{/if}{d.fileName}</a
								>
								<span class="flex items-center gap-1 text-xs text-muted-foreground"
									>{docSize(d.size)} · {formatDate(d.createdAt)}{d.uploadedBy
										? ` · ${d.uploadedBy}`
										: ''}{#if d.expiresOn}
										<span class={docExpiryTone(d.expiresOn)}>· expires {d.expiresOn}</span
										>{/if}</span
								>
							</div>
						</div>
						<DropdownMenu.Root>
							<DropdownMenu.Trigger
								class="inline-flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-accent"
							>
								<EllipsisVertical class="size-4" />
							</DropdownMenu.Trigger>
							<DropdownMenu.Content align="end">
								<DropdownMenu.Item onclick={() => openDocExpiry(d)}>Set expiry…</DropdownMenu.Item>
								{#if d.expiresOn}
									<DropdownMenu.Item
										onclick={() =>
											setMemberDocExpiry({
												id: d.id,
												memberId: id,
												expiresOn: null
											}).updates(getMemberProfile)}>Clear expiry</DropdownMenu.Item
									>
								{/if}
								<DropdownMenu.Item
									class="text-destructive"
									onclick={() =>
										removeMemberDoc({ id: d.id, memberId: id }).updates(getMemberProfile)}
									>Remove</DropdownMenu.Item
								>
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					</div>
				{:else}
					<Empty.Root class="border-0 py-2">
						<Empty.Header>
							<Empty.Media><Paperclip /></Empty.Media>
							<Empty.Title class="text-sm">No documents</Empty.Title>
							<Empty.Description class="text-xs"
								>Licenses, certifications and insurance for this tech.</Empty.Description
							>
						</Empty.Header>
					</Empty.Root>
				{/each}
			</Card.Content>
		</Card.Root>
	</div>

	<div class="space-y-6 xl:col-span-2">
		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">Upcoming jobs — next 14 days</Card.Title>
				<Card.Description>{p.upcoming.length} scheduled</Card.Description>
			</Card.Header>
			<Card.Content class="overflow-x-auto px-0">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head class="pl-6">When</Table.Head>
							<Table.Head>Job</Table.Head>
							<Table.Head>Customer</Table.Head>
							<Table.Head>Type</Table.Head>
							<Table.Head class="pr-6">Status</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each p.upcoming as j (j.job.id)}
							<Table.Row>
								<Table.Cell class="pl-6 whitespace-nowrap"
									>{formatDate(j.job.startsAt)}
									{j.job.startsAt ? localTime(j.job.startsAt, tz) : ''}</Table.Cell
								>
								<Table.Cell
									><a class="font-medium underline-offset-2 hover:underline" href="/jobs/{j.job.id}"
										>J-{j.job.number}</a
									>
									<span class="ml-1 text-muted-foreground">{j.job.summary}</span></Table.Cell
								>
								<Table.Cell>{j.customerName}</Table.Cell>
								<Table.Cell>{j.jobTypeName ?? '—'}</Table.Cell>
								<Table.Cell class="pr-6"><StatusBadge status={j.job.status} /></Table.Cell>
							</Table.Row>
						{:else}
							<Table.Row>
								<Table.Cell colspan={5} class="py-6 text-center text-muted-foreground"
									>No scheduled jobs in the next two weeks.</Table.Cell
								>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">Recent time entries</Card.Title>
				<Card.Description>Latest clock-ins across jobs</Card.Description>
			</Card.Header>
			<Card.Content class="overflow-x-auto px-0">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head class="pl-6">Started</Table.Head>
							<Table.Head>Job</Table.Head>
							<Table.Head class="text-right">Duration</Table.Head>
							<Table.Head class="pr-6">Note</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each p.entries as e (e.id)}
							<Table.Row>
								<Table.Cell class="pl-6 whitespace-nowrap">{formatRelative(e.startedAt)}</Table.Cell
								>
								<Table.Cell
									><a class="underline-offset-2 hover:underline" href="/jobs/{e.jobId}"
										>J-{e.jobNumber}</a
									>
									<span class="ml-1 text-muted-foreground">{e.jobSummary}</span></Table.Cell
								>
								<Table.Cell class="text-right tabular-nums"
									>{fmtHours(entryMin(e))}{e.endedAt ? '' : ' · open'}</Table.Cell
								>
								<Table.Cell class="pr-6 text-muted-foreground">{e.note || '—'}</Table.Cell>
							</Table.Row>
						{:else}
							<Table.Row>
								<Table.Cell colspan={4} class="py-6 text-center text-muted-foreground"
									>No time entries yet.</Table.Cell
								>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">Recently completed</Card.Title>
				<Card.Description>Last finished jobs</Card.Description>
			</Card.Header>
			<Card.Content class="overflow-x-auto px-0">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head class="pl-6">Job</Table.Head>
							<Table.Head>Customer</Table.Head>
							<Table.Head>Completed</Table.Head>
							<Table.Head class="pr-6 text-right">Rating</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each p.recentDone as j (j.id)}
							<Table.Row>
								<Table.Cell class="pl-6"
									><a class="font-medium underline-offset-2 hover:underline" href="/jobs/{j.id}"
										>J-{j.number}</a
									>
									<span class="ml-1 text-muted-foreground">{j.summary}</span></Table.Cell
								>
								<Table.Cell>{j.customerName}</Table.Cell>
								<Table.Cell class="whitespace-nowrap"
									>{j.completedAt ? formatDate(j.completedAt) : '—'}</Table.Cell
								>
								<Table.Cell class="pr-6 text-right tabular-nums">{j.rating ?? '—'}</Table.Cell>
							</Table.Row>
						{:else}
							<Table.Row>
								<Table.Cell colspan={4} class="py-6 text-center text-muted-foreground"
									>No completed jobs yet.</Table.Cell
								>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>
	</div>
</div>

<Dialog.Root bind:open={expOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Document expiry</Dialog.Title>
			<Dialog.Description>
				License, cert or insurance expiry — surfaces on the dashboard when it's within 30 days.
			</Dialog.Description>
		</Dialog.Header>
		<form
			class="space-y-4"
			onsubmit={(e) => {
				e.preventDefault();
				saveDocExpiry();
			}}
		>
			<Input type="date" bind:value={expDate} />
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (expOpen = false)}>Cancel</Button>
				<Button type="submit">Save</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
