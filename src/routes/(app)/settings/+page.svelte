<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { ApiPermissions } from '#lib/api-permissions.ts';
	import PageHeader from '#lib/components/app/page-header.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { toast } from 'svelte-sonner';
	import { authClient } from '#lib/auth-client.ts';
	import {
		getSettings,
		updateSettings,
		getOffices,
		createOffice,
		updateOffice,
		getWebhooks,
		createWebhook,
		toggleWebhook,
		deleteWebhook,
		getStaff,
		seedDemo
	} from '#lib/remote/workspace.remote.ts';
	import {
		getJobTypes,
		createJobType,
		updateJobType,
		getTechnicians,
		getTimeOff,
		addTimeOff,
		deleteTimeOff
	} from '#lib/remote/jobs.remote.ts';
	import {
		getPaymentProviders,
		toggleProvider,
		connectProvider,
		refreshProvider
	} from '#lib/remote/payments.remote.ts';
	import { getApiKeys, createApiKey, deleteApiKey } from '#lib/remote/api-keys.remote.ts';
	import { API_RESOURCES } from '#lib/api-permissions.ts';
	import { errMsg, formatDate } from '#lib/format.ts';
	import { tour } from '#lib/components/app/tour.svelte.ts';
	import Plus from '@lucide/svelte/icons/plus';
	import Copy from '@lucide/svelte/icons/copy';
	import Trash from '@lucide/svelte/icons/trash-2';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import GraduationCap from '@lucide/svelte/icons/graduation-cap';

	let settings = $state(await getSettings());
	let offices = $state(await getOffices());
	let webhooks = $state(await getWebhooks());
	let apiKeys = $state(await getApiKeys());
	let providerList = $state(await getPaymentProviders());
	const staff = await getStaff();
	let pending = $state(false);

	// ------- time off -------
	let timeOff = $state(await getTimeOff());
	const techs = await getTechnicians();
	let toMember = $state('');
	let toStart = $state('');
	let toEnd = $state('');
	let toReason = $state('');
	async function saveTimeOff(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			await addTimeOff({
				memberId: toMember,
				startsOn: toStart,
				endsOn: toEnd,
				reason: toReason
			}).updates(getTimeOff);
			toast.success('Time off added');
			toStart = toEnd = toReason = '';
			timeOff = await getTimeOff();
		} catch (err) {
			toast.error(errMsg(err, 'Could not add time off'));
		}
		pending = false;
	}
	async function removeTimeOff(id: string) {
		try {
			await deleteTimeOff(id).updates(getTimeOff);
			timeOff = await getTimeOff();
		} catch (err) {
			toast.error(errMsg(err, 'Could not remove'));
		}
	}

	// ------- job types -------
	let jobTypes = $state(await getJobTypes());
	let jtOpen = $state(false);
	let jtEdit: (typeof jobTypes)[number] | null = $state(null);
	let jtName = $state('');
	let jtDescription = $state('');
	let jtDuration = $state(60);
	let jtAmount = $state<number | null>(null);
	let jtTech = $state('');
	let jtChecklist = $state('');
	let jtActive = $state(true);

	function openJt(t?: (typeof jobTypes)[number]) {
		jtEdit = t ?? null;
		jtName = t?.name ?? '';
		jtDescription = t?.description ?? '';
		jtDuration = t?.durationMin ?? 60;
		jtAmount = t?.defaultAmount ?? null;
		jtTech = t?.technicianId ?? '';
		jtChecklist = (t?.checklist ?? []).join('\n');
		jtActive = t?.active ?? true;
		jtOpen = true;
	}
	async function saveJt(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		const body = {
			name: jtName,
			description: jtDescription,
			durationMin: jtDuration,
			defaultAmount: jtAmount,
			technicianId: jtTech || null,
			checklist: jtChecklist
				.split('\n')
				.map((l) => l.trim())
				.filter(Boolean),
			active: jtActive
		};
		try {
			if (jtEdit) await updateJobType({ id: jtEdit.id, ...body }).updates(getJobTypes);
			else await createJobType(body).updates(getJobTypes);
			jobTypes = await getJobTypes();
			toast.success(jtEdit ? 'Job type updated' : 'Job type created');
			jtOpen = false;
		} catch (err) {
			toast.error(errMsg(err, 'Could not save job type'));
		}
		pending = false;
	}
	async function toggleJt(t: (typeof jobTypes)[number], active: boolean) {
		try {
			await updateJobType({ id: t.id, active }).updates(getJobTypes);
			jobTypes = await getJobTypes();
		} catch (err) {
			toast.error(errMsg(err, 'Could not update job type'));
		}
	}

	// ------- general -------
	let timezone = $state(settings.timezone);
	let currency = $state(settings.currency);
	let tagline = $state(settings.tagline);
	let address = $state(settings.address);
	let phone = $state(settings.phone);
	let website = $state(settings.website);
	let reviewUrl = $state(settings.reviewUrl);
	let publicPage = $state(settings.publicPage);
	const bookUrl = $derived(`${page.url.origin}/book/${page.data.org.slug}`);
	const embedSnippet = $derived(
		`<iframe src="${bookUrl}" style="width:100%;max-width:720px;height:640px;border:0" title="Book a service"></iframe>`
	);
	async function copyText(text: string, msg: string) {
		try {
			await navigator.clipboard.writeText(text);
			toast.success(msg);
		} catch (err) {
			toast.error(errMsg(err, 'Could not copy'));
		}
	}
	const tzOptions = Intl.supportedValuesOf('timeZone');
	const currencyOptions = ['usd', 'eur', 'gbp', 'aud', 'cad', 'nzd', 'brl', 'inr'];
	async function saveSettings(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			settings = await updateSettings({
				timezone,
				currency,
				tagline,
				address,
				phone,
				website,
				reviewUrl,
				publicPage
			});
			toast.success('Settings saved');
		} catch (err) {
			toast.error(errMsg(err, 'Could not save'));
		}
		pending = false;
	}

	// ------- offices -------
	let locOpen = $state(false);
	let locName = $state('');
	async function addOffice(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			await createOffice({ name: locName });
			offices = await getOffices();
			locOpen = false;
			locName = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not add'));
		}
		pending = false;
	}
	async function archiveOffice(id: string, archived: boolean) {
		try {
			await updateOffice({ id, archived });
			offices = await getOffices();
		} catch (err) {
			toast.error(errMsg(err, 'Could not update'));
		}
	}

	// ------- team -------
	let inviteEmail = $state('');
	let inviteRole = $state<'admin' | 'member'>('member');
	async function invite(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		const { error } = await authClient.organization.inviteMember({
			email: inviteEmail,
			role: inviteRole
		});
		pending = false;
		if (error) return toast.error(error.message ?? 'Could not invite');
		toast.success(`Invitation sent to ${inviteEmail}`);
		inviteEmail = '';
	}
	async function removeStaff(id: string) {
		const { error } = await authClient.organization.removeMember({ memberIdOrEmail: id });
		if (error) return toast.error(error.message ?? 'Could not remove');
		toast.success('Removed');
	}

	// ------- api keys -------
	let keyName = $state('');
	let keyPerms = $state<Record<string, boolean>>({});
	let newKey = $state<string | null>(null);
	async function createKey(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			const permissions: ApiPermissions = Object.fromEntries(
				Object.entries(keyPerms)
					.filter(([, on]) => on)
					.map(([res]) => [res, ['read', 'write']])
			);
			const { key } = await createApiKey({ name: keyName, permissions });
			newKey = key;
			keyName = '';
			keyPerms = {};
			apiKeys = await getApiKeys();
		} catch (err) {
			toast.error(errMsg(err, 'Could not create key'));
		}
		pending = false;
	}
	async function removeKey(id: string) {
		try {
			await deleteApiKey(id);
			apiKeys = await getApiKeys();
		} catch (err) {
			toast.error(errMsg(err, 'Could not delete'));
		}
	}

	// ------- webhooks -------
	let hookUrl = $state('');
	let hookEvents = $state('job.created,job.completed,payment.recorded');
	async function addWebhook(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			await createWebhook({
				url: hookUrl,
				events: hookEvents
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean)
			});
			webhooks = await getWebhooks();
			hookUrl = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not add webhook'));
		}
		pending = false;
	}

	// ------- payments -------
	async function copy(text: string) {
		await navigator.clipboard.writeText(text);
		toast.success('Copied');
	}
</script>

<PageHeader title="Settings" />

<div class="p-4 md:p-6">
	<Tabs.Root value="general">
		<Tabs.List class="mb-4 flex-wrap">
			<Tabs.Trigger value="general">General</Tabs.Trigger>
			<Tabs.Trigger value="offices">Offices</Tabs.Trigger>
			<Tabs.Trigger value="team">Team</Tabs.Trigger>
			<Tabs.Trigger value="jobtypes">Job types</Tabs.Trigger>
			<Tabs.Trigger value="payments">Payments</Tabs.Trigger>
			<Tabs.Trigger value="api">API</Tabs.Trigger>
			<Tabs.Trigger value="webhooks">Webhooks</Tabs.Trigger>
			<Tabs.Trigger value="demo">Demo</Tabs.Trigger>
		</Tabs.List>

		<Tabs.Content value="general">
			<Card.Root class="max-w-2xl">
				<Card.Header>
					<Card.Title class="text-base">Workspace</Card.Title>
					<Card.Description>Timezone, currency and the public booking page.</Card.Description>
				</Card.Header>
				<Card.Content>
					<form class="space-y-4" onsubmit={saveSettings}>
						<div class="grid gap-4 sm:grid-cols-2">
							<Field.Field>
								<Field.Label>Timezone</Field.Label>
								<Select.Root type="single" bind:value={timezone}>
									<Select.Trigger class="w-full">{timezone}</Select.Trigger>
									<Select.Content>
										{#each tzOptions as t (t)}
											<Select.Item value={t}>{t}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
								<Field.Description
									>Job times and agreement billing run in this zone.</Field.Description
								>
							</Field.Field>
							<Field.Field>
								<Field.Label>Currency</Field.Label>
								<Select.Root type="single" bind:value={currency}>
									<Select.Trigger class="w-full">{currency.toUpperCase()}</Select.Trigger>
									<Select.Content>
										{#each currencyOptions as c (c)}
											<Select.Item value={c}>{c.toUpperCase()}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							</Field.Field>
						</div>
						<Field.Field>
							<Field.Label for="tagline">Tagline</Field.Label>
							<Input
								id="tagline"
								bind:value={tagline}
								placeholder="Heating, cooling and plumbing done right."
							/>
						</Field.Field>
						<Field.Field>
							<Field.Label for="addr">Address</Field.Label>
							<Input id="addr" bind:value={address} />
						</Field.Field>
						<div class="grid gap-4 sm:grid-cols-2">
							<Field.Field>
								<Field.Label for="phone">Phone</Field.Label>
								<Input id="phone" bind:value={phone} />
							</Field.Field>
							<Field.Field>
								<Field.Label for="site">Website</Field.Label>
								<Input id="site" bind:value={website} />
							</Field.Field>
						</div>
						<Field.Field>
							<Field.Label for="review">Review link</Field.Label>
							<Input
								id="review"
								placeholder="https://g.page/r/your-google-review-link"
								bind:value={reviewUrl}
							/>
							<p class="text-xs text-muted-foreground">
								A "Leave a review" button in the email customers get when a job is marked done.
								Leave empty to disable.
							</p>
						</Field.Field>
						<div class="flex items-center justify-between rounded-lg border p-3 text-sm">
							<div>
								<p class="font-medium">Public booking page</p>
								<p class="text-xs text-muted-foreground">
									Let customers request service online at /book/{'{slug}'}.
								</p>
							</div>
							<Switch bind:checked={publicPage} />
						</div>
						{#if publicPage}
							<div class="space-y-2 rounded-lg border p-3 text-sm">
								<div class="flex items-center justify-between gap-2">
									<p class="font-medium">Embed on your website</p>
									<Button
										size="sm"
										variant="outline"
										href="{page.url.origin}/book/{page.data.org.slug}"
										target="_blank"><ExternalLink class="size-4" /> Preview</Button
									>
								</div>
								<p class="text-xs text-muted-foreground">
									Link customers to your booking page or drop the iframe into any site.
								</p>
								<div class="flex items-center gap-2">
									<Input
										readonly
										class="font-mono text-xs"
										value="{page.url.origin}/book/{page.data.org.slug}"
									/>
									<Button
										size="sm"
										variant="outline"
										onclick={() => copyText(bookUrl, 'Booking link copied')}
										><Copy class="size-4" /></Button
									>
								</div>
								<div class="flex items-center gap-2">
									<Input readonly class="font-mono text-xs" value={embedSnippet} />
									<Button
										size="sm"
										variant="outline"
										onclick={() => copyText(embedSnippet, 'Embed snippet copied')}
										><Copy class="size-4" /></Button
									>
								</div>
							</div>
						{/if}
						<Button type="submit" disabled={pending}>Save</Button>
					</form>
				</Card.Content>
			</Card.Root>

			<Card.Root class="mt-4 max-w-2xl">
				<Card.Header>
					<Card.Title class="text-base">Preferences</Card.Title>
					<Card.Description>Saved to this browser, not your profile.</Card.Description>
				</Card.Header>
				<Card.Content>
					<div class="flex items-center justify-between rounded-lg border p-3 text-sm">
						<div>
							<p class="font-medium">Guided tour</p>
							<p class="text-xs text-muted-foreground">
								Walk through the main screens again — runs automatically on first login.
							</p>
						</div>
						<Button size="sm" variant="outline" onclick={() => tour.start()}
							><GraduationCap /> Replay tour</Button
						>
					</div>
				</Card.Content>
			</Card.Root>
		</Tabs.Content>

		<Tabs.Content value="offices">
			<Card.Root class="max-w-2xl">
				<Card.Header class="flex-row items-center justify-between">
					<div>
						<Card.Title class="text-base">Offices</Card.Title>
						<Card.Description>Branch offices jobs can be attributed to.</Card.Description>
					</div>
					<Button size="sm" variant="outline" onclick={() => (locOpen = true)}><Plus /> Add</Button>
				</Card.Header>
				<Card.Content class="px-6">
					<ul class="divide-y">
						{#each offices as l (l.id)}
							<li class="flex items-center justify-between py-3 text-sm">
								<div>
									<p class="font-medium">{l.name}</p>
									{#if l.address}<p class="text-xs text-muted-foreground">{l.address}</p>{/if}
								</div>
								<Button
									variant="ghost"
									size="sm"
									class="h-7 px-2 text-xs"
									onclick={() => archiveOffice(l.id, !l.archivedAt)}
									>{l.archivedAt ? 'Restore' : 'Archive'}</Button
								>
							</li>
						{:else}
							<li class="py-6 text-sm text-muted-foreground">No offices — add your main branch.</li>
						{/each}
					</ul>
				</Card.Content>
			</Card.Root>
		</Tabs.Content>

		<Tabs.Content value="team">
			<Card.Root class="max-w-2xl">
				<Card.Header>
					<Card.Title class="text-base">Team</Card.Title>
					<Card.Description>Staff become technicians on the dispatch board.</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-4 px-6">
					<ul class="divide-y">
						{#each staff as s (s.id)}
							<li class="flex items-center justify-between py-3 text-sm">
								<div class="min-w-0">
									<p class="truncate font-medium">{s.name}</p>
									<p class="truncate text-xs text-muted-foreground">{s.email}</p>
								</div>
								<div class="flex items-center gap-2">
									<Badge
										variant={s.role === 'owner' || s.role === 'admin' ? 'default' : 'secondary'}
										>{s.role}</Badge
									>
									{#if s.role !== 'owner'}
										<Button
											variant="ghost"
											size="icon"
											class="size-7"
											onclick={() => removeStaff(s.id)}><Trash class="size-4" /></Button
										>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
					<form class="flex gap-2" onsubmit={invite}>
						<Input
							type="email"
							required
							placeholder="tech@yourcompany.com"
							bind:value={inviteEmail}
							class="max-w-xs"
						/>
						<Select.Root type="single" bind:value={inviteRole}>
							<Select.Trigger class="w-28">{inviteRole}</Select.Trigger>
							<Select.Content>
								<Select.Item value="member">member</Select.Item>
								<Select.Item value="admin">admin</Select.Item>
							</Select.Content>
						</Select.Root>
						<Button type="submit" variant="secondary" disabled={pending}>Invite</Button>
					</form>
				</Card.Content>
			</Card.Root>

			<Card.Root class="max-w-2xl">
				<Card.Header>
					<Card.Title class="text-base">Time off</Card.Title>
					<Card.Description
						>Days a technician is unavailable — scheduling a job on those days is blocked.</Card.Description
					>
				</Card.Header>
				<Card.Content class="space-y-4 px-6">
					<ul class="divide-y">
						{#each timeOff as t (t.timeOff.id)}
							<li class="flex items-center justify-between py-3 text-sm">
								<div class="min-w-0">
									<p class="font-medium">{t.memberName}</p>
									<p class="text-xs text-muted-foreground">
										{t.timeOff.startsOn}{t.timeOff.endsOn !== t.timeOff.startsOn
											? ` – ${t.timeOff.endsOn}`
											: ''}{t.timeOff.reason ? ` · ${t.timeOff.reason}` : ''}
									</p>
								</div>
								<Button
									variant="ghost"
									size="icon"
									class="size-7"
									onclick={() => removeTimeOff(t.timeOff.id)}><Trash class="size-4" /></Button
								>
							</li>
						{:else}
							<li class="py-2 text-sm text-muted-foreground">No time off scheduled.</li>
						{/each}
					</ul>
					<form
						class="grid grid-cols-2 gap-2 md:grid-cols-[1fr_1fr_1fr_1fr_auto]"
						onsubmit={saveTimeOff}
					>
						<Select.Root
							type="single"
							value={toMember}
							onValueChange={(v: string) => (toMember = v)}
						>
							<Select.Trigger class="w-full"
								>{techs.find((t) => t.id === toMember)?.name ?? 'Technician…'}</Select.Trigger
							>
							<Select.Content>
								{#each techs as t (t.id)}
									<Select.Item value={t.id}>{t.name}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
						<Input type="date" required aria-label="First day off" bind:value={toStart} />
						<Input type="date" required aria-label="Last day off" bind:value={toEnd} />
						<Input placeholder="Reason (optional)" bind:value={toReason} />
						<Button type="submit" variant="secondary" disabled={pending || !toMember}>Add</Button>
					</form>
				</Card.Content>
			</Card.Root>
		</Tabs.Content>

		<Tabs.Content value="jobtypes">
			<Card.Root class="max-w-2xl">
				<Card.Header class="flex-row items-center justify-between space-y-0">
					<div>
						<Card.Title class="text-base">Job types</Card.Title>
						<Card.Description>
							Service catalog for dispatch — default tech, duration, price, and a checklist copied
							onto each new job.
						</Card.Description>
					</div>
					<Button size="sm" onclick={() => openJt()}><Plus /> New type</Button>
				</Card.Header>
				<Card.Content class="px-0">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Name</Table.Head>
								<Table.Head class="hidden md:table-cell">Duration</Table.Head>
								<Table.Head class="hidden md:table-cell">Checklist</Table.Head>
								<Table.Head class="hidden md:table-cell">Default tech</Table.Head>
								<Table.Head class="text-right">Active</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each jobTypes as t (t.id)}
								<Table.Row class="cursor-pointer" onclick={() => openJt(t)}>
									<Table.Cell class="font-medium">{t.name}</Table.Cell>
									<Table.Cell class="hidden text-muted-foreground md:table-cell"
										>{t.durationMin} min</Table.Cell
									>
									<Table.Cell class="hidden text-muted-foreground md:table-cell"
										>{t.checklist?.length ? `${t.checklist.length} steps` : '—'}</Table.Cell
									>
									<Table.Cell class="hidden text-muted-foreground md:table-cell"
										>{techs.find((x) => x.id === t.technicianId)?.name ?? '—'}</Table.Cell
									>
									<Table.Cell class="text-right" onclick={(e) => e.stopPropagation()}>
										<Switch checked={t.active} onCheckedChange={(v) => toggleJt(t, v)} />
									</Table.Cell>
								</Table.Row>
							{:else}
								<Table.Row>
									<Table.Cell colspan={5} class="text-center text-muted-foreground">
										No job types yet — create one to speed up dispatch.
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</Card.Content>
			</Card.Root>
		</Tabs.Content>

		<Tabs.Content value="payments">
			<div class="max-w-3xl space-y-4">
				{#each providerList as p (p.id)}
					<Card.Root>
						<Card.Header class="flex-row items-start justify-between gap-4">
							<div>
								<Card.Title class="flex items-center gap-2 text-base">
									{p.name}
									{#if !p.configured}<Badge variant="outline">not configured</Badge>
									{:else if p.ready}<Badge>ready</Badge>
									{:else}<Badge variant="secondary">setup needed</Badge>{/if}
								</Card.Title>
								<Card.Description>{p.description}</Card.Description>
							</div>
							<Switch
								checked={p.enabled}
								disabled={!p.configured || !p.ready || !p.supportsCurrency}
								onCheckedChange={async (v) => {
									await toggleProvider({ id: p.id, enabled: v });
									providerList = await getPaymentProviders();
								}}
							/>
						</Card.Header>
						<Card.Content class="space-y-2 px-6 text-sm text-muted-foreground">
							{#if p.hint}<p>{p.hint}</p>{/if}
							{#if !p.configured}
								<p>
									Set
									{#each p.env as e (e)}<code class="rounded bg-muted px-1">{e}</code>
									{/each}
									to enable.
								</p>
							{:else}
								<div class="flex items-center gap-2">
									<code class="rounded bg-muted px-2 py-0.5 text-xs">{p.webhookPath}</code>
									<Button
										variant="ghost"
										size="icon"
										class="size-7"
										onclick={() => copy(`${page.url.origin}${p.webhookPath}`)}
										><Copy class="size-3.5" /></Button
									>
								</div>
								<p class="text-xs">Events: {p.webhookEvents.join(', ')}. {p.webhookNote ?? ''}</p>
								{#if p.canConnect && !p.ready}
									<Button
										size="sm"
										variant="outline"
										onclick={async () => {
											const res = await connectProvider(p.id);
											if (res?.url) location.href = res.url;
										}}><ExternalLink /> Connect {p.name} account</Button
									>
								{/if}
								{#if p.accountId && !p.accountReady}
									<Button
										size="sm"
										variant="ghost"
										onclick={async () => {
											await refreshProvider(p.id);
											providerList = await getPaymentProviders();
										}}>Refresh status</Button
									>
								{/if}
							{/if}
						</Card.Content>
					</Card.Root>
				{/each}
			</div>
		</Tabs.Content>

		<Tabs.Content value="api">
			<div class="max-w-3xl space-y-4">
				<Card.Root>
					<Card.Header>
						<Card.Title class="text-base">API keys</Card.Title>
						<Card.Description>
							Keys call <code class="rounded bg-muted px-1">/api/v1/…</code> as this workspace. Keep them
							secret — they're shown once.
						</Card.Description>
					</Card.Header>
					<Card.Content class="space-y-4 px-6">
						{#if newKey}
							<div
								class="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3"
							>
								<code class="min-w-0 flex-1 truncate font-mono text-xs">{newKey}</code>
								<Button variant="ghost" size="icon" class="size-7" onclick={() => copy(newKey!)}
									><Copy class="size-3.5" /></Button
								>
							</div>
						{/if}
						<Table.Root>
							<Table.Body>
								{#each apiKeys as k (k.id)}
									<Table.Row>
										<Table.Cell class="font-medium">{k.name}</Table.Cell>
										<Table.Cell class="font-mono text-xs text-muted-foreground"
											>{k.start ?? k.prefix}…</Table.Cell
										>
										<Table.Cell class="text-xs text-muted-foreground"
											>{formatDate(k.createdAt)}</Table.Cell
										>
										<Table.Cell class="text-right">
											<Button
												variant="ghost"
												size="icon"
												class="size-7"
												onclick={() => removeKey(k.id)}><Trash class="size-4" /></Button
											>
										</Table.Cell>
									</Table.Row>
								{:else}
									<Table.Row
										><Table.Cell class="text-muted-foreground">No keys yet.</Table.Cell></Table.Row
									>
								{/each}
							</Table.Body>
						</Table.Root>
						<form class="space-y-3" onsubmit={createKey}>
							<div class="flex gap-2">
								<Input
									required
									placeholder="Key name (e.g. Zapier)"
									bind:value={keyName}
									class="max-w-xs"
								/>
								<Button type="submit" variant="secondary" disabled={pending}>Create key</Button>
							</div>
							<div class="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
								{#each API_RESOURCES as r (r)}
									<label class="flex items-center gap-2">
										<input type="checkbox" bind:checked={keyPerms[r]} class="accent-primary" />
										{r}
									</label>
								{/each}
							</div>
						</form>
					</Card.Content>
				</Card.Root>
			</div>
		</Tabs.Content>

		<Tabs.Content value="webhooks">
			<div class="max-w-3xl space-y-4">
				<Card.Root>
					<Card.Header>
						<Card.Title class="text-base">Webhooks</Card.Title>
						<Card.Description>
							Signed POSTs (HMAC header <code class="rounded bg-muted px-1"
								>x-tredaro-signature</code
							>) for workspace events.
						</Card.Description>
					</Card.Header>
					<Card.Content class="space-y-4 px-6">
						<Table.Root>
							<Table.Body>
								{#each webhooks as w (w.id)}
									<Table.Row>
										<Table.Cell class="min-w-0 truncate font-mono text-xs">{w.url}</Table.Cell>
										<Table.Cell class="text-xs text-muted-foreground"
											>{w.events.length} events</Table.Cell
										>
										<Table.Cell
											><Switch
												checked={w.enabled}
												onCheckedChange={async (v) => {
													await toggleWebhook({ id: w.id, enabled: v });
													webhooks = await getWebhooks();
												}}
											/></Table.Cell
										>
										<Table.Cell class="text-right">
											<Button
												variant="ghost"
												size="icon"
												class="size-7"
												onclick={async () => {
													await deleteWebhook(w.id);
													webhooks = await getWebhooks();
												}}><Trash class="size-4" /></Button
											>
										</Table.Cell>
									</Table.Row>
								{:else}
									<Table.Row
										><Table.Cell class="text-muted-foreground">No webhooks.</Table.Cell></Table.Row
									>
								{/each}
							</Table.Body>
						</Table.Root>
						<form class="space-y-3" onsubmit={addWebhook}>
							<Field.Field>
								<Field.Label for="hook-url">Endpoint URL</Field.Label>
								<Input
									id="hook-url"
									type="url"
									required
									placeholder="https://…"
									bind:value={hookUrl}
								/>
							</Field.Field>
							<Field.Field>
								<Field.Label for="hook-events">Events (comma-separated, or *)</Field.Label>
								<Input id="hook-events" bind:value={hookEvents} />
								<Field.Description
									>e.g. job.created, estimate.approved, payment.recorded</Field.Description
								>
							</Field.Field>
							<Button type="submit" variant="secondary" disabled={pending}>Add webhook</Button>
						</form>
					</Card.Content>
				</Card.Root>
			</div>
		</Tabs.Content>

		<Tabs.Content value="demo">
			<Card.Root class="max-w-2xl">
				<Card.Header>
					<Card.Title class="text-base">Demo data</Card.Title>
					<Card.Description
						>Load a realistic HVAC company — customers, agreement plans, a week of jobs, an estimate
						and paid invoices. Only on an empty workspace.</Card.Description
					>
				</Card.Header>
				<Card.Content class="px-6">
					<Button
						variant="secondary"
						disabled={pending}
						onclick={async () => {
							pending = true;
							try {
								await seedDemo();
								toast.success('Demo company loaded — look around');
								await goto('/dashboard', { invalidateAll: true });
							} catch (err) {
								toast.error(errMsg(err, 'Could not seed'));
							}
							pending = false;
						}}><Sparkles /> Load demo data</Button
					>
				</Card.Content>
			</Card.Root>
		</Tabs.Content>
	</Tabs.Root>
</div>

<Dialog.Root bind:open={locOpen}>
	<Dialog.Content>
		<Dialog.Header><Dialog.Title>Add office</Dialog.Title></Dialog.Header>
		<form class="space-y-4" onsubmit={addOffice}>
			<Field.Field
				><Field.Label for="loc-name">Name</Field.Label><Input
					id="loc-name"
					required
					bind:value={locName}
					placeholder="Austin HQ"
					autofocus
				/></Field.Field
			>
			<Dialog.Footer><Button type="submit" disabled={pending}>Add</Button></Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<!-- job type editor -->
<Dialog.Root bind:open={jtOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{jtEdit ? `Edit ${jtEdit.name}` : 'New job type'}</Dialog.Title>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={saveJt}>
			<Field.Field>
				<Field.Label for="jt-name">Name</Field.Label>
				<Input id="jt-name" required bind:value={jtName} placeholder="AC tune-up" autofocus />
			</Field.Field>
			<Field.Field>
				<Field.Label for="jt-desc">Description</Field.Label>
				<Input id="jt-desc" bind:value={jtDescription} placeholder="Optional" />
			</Field.Field>
			<div class="grid grid-cols-2 gap-4">
				<Field.Field>
					<Field.Label for="jt-duration">Duration (min)</Field.Label>
					<Input id="jt-duration" type="number" min={5} required bind:value={jtDuration} />
				</Field.Field>
				<Field.Field>
					<Field.Label>Default tech</Field.Label>
					<Select.Root type="single" value={jtTech} onValueChange={(v: string) => (jtTech = v)}>
						<Select.Trigger class="w-full"
							>{techs.find((t) => t.id === jtTech)?.name ?? 'None'}</Select.Trigger
						>
						<Select.Content>
							<Select.Item value="">None</Select.Item>
							{#each techs as t (t.id)}
								<Select.Item value={t.id}>{t.name}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</Field.Field>
			</div>
			<Field.Field>
				<Field.Label for="jt-checklist">Checklist — one step per line</Field.Label>
				<Textarea
					id="jt-checklist"
					rows={4}
					placeholder="Inspect unit, check refrigerant… (one per line)"
					bind:value={jtChecklist}
				/>
				<Field.Description
					>New jobs of this type get these steps on their Checklist card.</Field.Description
				>
			</Field.Field>
			<div class="flex items-center justify-between">
				<label for="jt-active" class="text-sm font-medium">Active</label>
				<Switch id="jt-active" checked={jtActive} onCheckedChange={(v) => (jtActive = v)} />
			</div>
			<Dialog.Footer>
				<Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
