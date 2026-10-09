<script lang="ts">
	import EllipsisVertical from '@lucide/svelte/icons/ellipsis-vertical';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import Mails from '@lucide/svelte/icons/mails';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import PageHeader from '#lib/components/app/page-header.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import { toast } from 'svelte-sonner';
	import {
		getCustomer,
		getCustomers,
		updateCustomer,
		addServiceLocation,
		updateServiceLocation,
		createEquipment,
		updateEquipment,
		getPortalInvite,
		getCustomerDuplicates,
		mergeCustomers,
		textCustomerCmd,
		emailStatementCmd,
		getEquipmentJobs,
		revokePortalAccess
	} from '#lib/remote/customers.remote.ts';
	import { recordPayment, addCredit } from '#lib/remote/billing.remote.ts';
	import {
		getSchedules,
		createSchedule,
		updateSchedule,
		deleteSchedule
	} from '#lib/remote/maintenance.remote.ts';
	import { getJobTypes, getTechnicians } from '#lib/remote/jobs.remote.ts';
	import { errMsg, formatDate, formatMoney, formatRelative } from '#lib/format.ts';
	import { localDate, localTime } from '#lib/tz.ts';
	import { getSettings } from '#lib/remote/workspace.remote.ts';
	import Plus from '@lucide/svelte/icons/plus';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import AirVent from '@lucide/svelte/icons/air-vent';
	import Link2 from '@lucide/svelte/icons/link-2';
	import Wrench from '@lucide/svelte/icons/wrench';
	import Download from '@lucide/svelte/icons/download';
	import GitMerge from '@lucide/svelte/icons/git-merge';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Phone from '@lucide/svelte/icons/phone';
	import Mail from '@lucide/svelte/icons/mail';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import Repeat from '@lucide/svelte/icons/repeat';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	const id = $derived(page.params.id!);
	const c = $derived(await getCustomer(id));
	const settings = await getSettings();
	const currency = settings.currency;
	const tz = settings.timezone;

	// ------- maintenance schedules -------
	const schedules = $derived(await getSchedules(id));
	const jobTypes = await getJobTypes();
	let addingSc = $state(false);
	let scType = $state('');
	let scSummary = $state('');
	let scInterval = $state<7 | 14 | 30 | 90 | 180 | 365>(90);
	let scDate = $state('');
	const KIND_LABELS: Record<string, string> = {
		agreement_renewal: 'Agreement renewal reminder',
		agreement_renewal_sms: 'Agreement renewal text',
		appointment_reminder: 'Appointment reminder',
		appointment_reminder_sms: 'Appointment reminder text',
		booking_received: 'Booking request received',
		estimate_followup: 'Estimate follow-up',
		estimate_followup_sms: 'Estimate follow-up text',
		estimate_sent: 'Estimate sent',
		estimate_sent_sms: 'Estimate texted',
		invoice_sent: 'Invoice sent',
		invoice_texted: 'Invoice texted',
		invoice_overdue: 'Overdue invoice reminder',
		invoice_overdue_sms: 'Overdue invoice text',
		job_scheduled: 'Job scheduled',
		job_scheduled_sms: 'Job scheduled text',
		job_en_route_sms: 'En-route text',
		job_completed: 'Job completed follow-up',
		job_completed_sms: 'Job completed text',
		warranty_expiry: 'Warranty expiring reminder',
		manual_sms: 'Texted customer',
		parts_delay: 'Waiting on a part update',
		inbound_sms: 'Text from customer',
		statement: 'Statement emailed'
	};
	const kindLabel = (kind: string) =>
		KIND_LABELS[kind] ?? kind.replace(/_/g, ' ').replace(/sms$/, 'text');

	// ------- manual text -------
	let textOpen = $state(false);
	let textMsg = $state('');
	let textPending = $state(false);
	let commFilter = $state<'all' | 'email' | 'sms'>('all');
	async function sendText(e: SubmitEvent) {
		e.preventDefault();
		textPending = true;
		try {
			await textCustomerCmd({ customerId: id, message: textMsg.trim() });
			textOpen = false;
			textMsg = '';
			toast.success('Text sent');
		} catch (err) {
			toast.error(errMsg(err, 'Could not send text'));
		}
		textPending = false;
	}

	let stmtPending = $state(false);
	async function emailStatementNow() {
		stmtPending = true;
		try {
			await emailStatementCmd(id);
			toast.success('Statement sent');
		} catch (err) {
			toast.error(errMsg(err, 'Could not send statement'));
		}
		stmtPending = false;
	}

	const intervalLabel = (d: number) =>
		d === 7
			? 'weekly'
			: d === 14
				? 'every 2 weeks'
				: d === 30
					? 'monthly'
					: d === 90
						? 'quarterly'
						: d === 180
							? 'every 6 months'
							: 'yearly';
	async function saveSchedule(e: SubmitEvent) {
		e.preventDefault();
		try {
			await createSchedule({
				customerId: id,
				jobTypeId: scType || null,
				summary: scSummary,
				intervalDays: scInterval,
				nextDueOn: scDate,
				active: true
			}).updates(getSchedules);
			toast.success('Schedule added');
			addingSc = false;
			scType = scSummary = scDate = '';
			scInterval = 90;
		} catch (err) {
			toast.error(errMsg(err, 'Could not add schedule'));
		}
	}
	async function toggleSchedule(sc: (typeof schedules)[number]['schedule'], active: boolean) {
		try {
			await updateSchedule({ id: sc.id, active }).updates(getSchedules);
		} catch (err) {
			toast.error(errMsg(err, 'Could not update'));
		}
	}
	async function removeSchedule(scId: string) {
		try {
			await deleteSchedule(scId).updates(getSchedules);
		} catch (err) {
			toast.error(errMsg(err, 'Could not delete'));
		}
	}

	// ------- customer edit -------
	let name = $state(c.customer.name);
	let type = $state(c.customer.type);
	let companyName = $state(c.customer.companyName);
	let email = $state(c.customer.email);
	let phone = $state(c.customer.phone);
	let notes = $state(c.customer.notes);
	let status = $state(c.customer.status);
	let tagsInput = $state((c.customer.tags ?? []).join(', '));
	let smsOptOut = $state(c.customer.smsOptOut);
	let emailOptOut = $state(c.customer.emailOptOut);
	let onHold = $state(c.customer.onHold);
	let taxExempt = $state(c.customer.taxExempt);
	let leadSource = $state(c.customer.leadSource);
	let preferredMemberId = $state(c.customer.preferredMemberId ?? '');
	const technicians = $derived(await getTechnicians());
	let saving = $state(false);
	let loadedId = '';
	$effect(() => {
		if (c.customer.id !== loadedId) {
			loadedId = c.customer.id;
			name = c.customer.name;
			type = c.customer.type;
			companyName = c.customer.companyName;
			email = c.customer.email;
			phone = c.customer.phone;
			notes = c.customer.notes;
			status = c.customer.status;
			tagsInput = (c.customer.tags ?? []).join(', ');
			smsOptOut = c.customer.smsOptOut;
			emailOptOut = c.customer.emailOptOut;
			onHold = c.customer.onHold;
			taxExempt = c.customer.taxExempt;
			leadSource = c.customer.leadSource;
			preferredMemberId = c.customer.preferredMemberId ?? '';
		}
	});

	async function saveCustomer(e: SubmitEvent) {
		e.preventDefault();
		saving = true;
		try {
			await updateCustomer({
				id,
				name,
				type,
				companyName,
				email,
				phone,
				notes,
				status,
				tags: tagsInput
					.split(',')
					.map((t) => t.trim())
					.filter(Boolean),
				smsOptOut,
				emailOptOut,
				onHold,
				taxExempt,
				leadSource,
				preferredMemberId: preferredMemberId || null
			});
			toast.success('Customer saved');
		} catch (err) {
			toast.error(errMsg(err, 'Could not save'));
		}
		saving = false;
	}

	// ------- locations -------
	let locOpen = $state(false);
	let locPending = $state(false);
	let locId = $state<string | null>(null);
	let label = $state('');
	let address1 = $state('');
	let city = $state('');
	let addrState = $state('');
	let zip = $state('');
	let accessNotes = $state('');

	function openLocation(l?: (typeof c.locations)[number]) {
		locId = l?.id ?? null;
		label = l?.label ?? '';
		address1 = l?.address1 ?? '';
		city = l?.city ?? '';
		addrState = l?.state ?? '';
		zip = l?.zip ?? '';
		accessNotes = l?.accessNotes ?? '';
		locOpen = true;
	}

	async function saveLocation(e: SubmitEvent) {
		e.preventDefault();
		locPending = true;
		try {
			const loc = { label, address1, city, state: addrState, zip, accessNotes };
			if (locId) {
				await updateServiceLocation({ id: locId, ...loc });
			} else {
				await addServiceLocation({ customerId: id, ...loc });
			}
			toast.success('Location saved');
			locOpen = false;
		} catch (err) {
			toast.error(errMsg(err, 'Could not save location'));
		}
		locPending = false;
	}

	// ------- equipment -------
	let eqOpen = $state(false);
	let eqPending = $state(false);
	let eqId = $state<string | null>(null);
	let eqName = $state('');
	let eqLocationId = $state('');
	let eqCategory = $state('');
	let eqBrand = $state('');
	let eqModel = $state('');
	let eqSerial = $state('');
	let eqInstalled = $state('');
	let eqWarranty = $state('');
	let eqServiceDue = $state('');
	let eqNotes = $state('');
	let eqActive = $state(true);

	function openEquipment(e?: (typeof c.equipment)[number]) {
		eqId = e?.equipment.id ?? null;
		eqName = e?.equipment.name ?? '';
		eqLocationId = e?.equipment.serviceLocationId ?? '';
		eqCategory = e?.equipment.category ?? '';
		eqBrand = e?.equipment.brand ?? '';
		eqModel = e?.equipment.model ?? '';
		eqSerial = e?.equipment.serial ?? '';
		eqInstalled = e?.equipment.installedOn ?? '';
		eqWarranty = e?.equipment.warrantyUntil ?? '';
		eqServiceDue = e?.equipment.nextServiceDue ?? '';
		eqNotes = e?.equipment.notes ?? '';
		eqActive = e?.equipment.active ?? true;
		if (eqId) void getEquipmentJobs(eqId).refresh();
		eqOpen = true;
	}

	const today = new Date().toISOString().slice(0, 10);
	const eqExpired = (warranty: string | null) => !!warranty && warranty < today;

	async function saveEquipment(e: SubmitEvent) {
		e.preventDefault();
		eqPending = true;
		try {
			const eq = {
				serviceLocationId: eqLocationId || null,
				name: eqName,
				category: eqCategory,
				brand: eqBrand,
				model: eqModel,
				serial: eqSerial,
				installedOn: eqInstalled || null,
				warrantyUntil: eqWarranty || null,
				nextServiceDue: eqServiceDue || null,
				notes: eqNotes
			};
			if (eqId) {
				await updateEquipment({ id: eqId, ...eq, active: eqActive });
			} else {
				await createEquipment({ customerId: id, ...eq });
			}
			toast.success('Equipment saved');
			eqOpen = false;
		} catch (err) {
			toast.error(errMsg(err, 'Could not save equipment'));
		}
		eqPending = false;
	}

	// ------- merge duplicates -------
	const dupes = $derived(await getCustomerDuplicates(id));
	let mergeOpen = $state(false);
	let mergeSource = $state('');
	let mergePending = $state(false);
	const mergeTarget = $derived(dupes.find((d) => d.customer.id === mergeSource));
	async function doMerge() {
		if (!mergeTarget) return;
		mergePending = true;
		try {
			await mergeCustomers({
				sourceId: mergeTarget.customer.id,
				targetId: id
			}).updates(getCustomer, getCustomerDuplicates, getCustomers);
			toast.success(`Merged ${mergeTarget.customer.name} into ${c.customer.name}`);
			mergeOpen = false;
			mergeSource = '';
			// Merge may have filled blank contact fields — re-bind the record form.
			const merged = (await getCustomer(id)).customer;
			name = merged.name;
			type = merged.type;
			companyName = merged.companyName;
			email = merged.email;
			phone = merged.phone;
			notes = merged.notes;
			status = merged.status;
		} catch (err) {
			toast.error(errMsg(err, 'Could not merge'));
		}
		mergePending = false;
	}

	// ------- portal link -------
	async function copyPortal() {
		try {
			const { url } = await getPortalInvite(id);
			await navigator.clipboard.writeText(url);
			toast.success('Portal link copied — send it to the customer');
		} catch (err) {
			toast.error(errMsg(err, 'Could not get link'));
		}
	}

	let revokePending = $state(false);
	async function revokePortal() {
		revokePending = true;
		try {
			await revokePortalAccess(id).updates(getCustomer);
			toast.success('Portal access revoked');
		} catch (err) {
			toast.error(errMsg(err, 'Could not revoke'));
		}
		revokePending = false;
	}

	// ------- record payment -------
	let payOpen = $state(false);
	let payPending = $state(false);
	let payDollars = $state('');
	let payMethod = $state<'cash' | 'card' | 'bank' | 'other'>('cash');
	let payNote = $state('');
	const payCents = $derived(Math.round((parseFloat(payDollars) || 0) * 100));

	async function submitPayment(e: SubmitEvent) {
		e.preventDefault();
		payPending = true;
		try {
			await recordPayment({
				customerId: id,
				amount: payCents,
				method: payMethod,
				notes: payNote
			});
			toast.success('Payment recorded');
			payOpen = false;
			payDollars = payNote = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not record payment'));
		}
		payPending = false;
	}

	// ------- account credit -------
	let creditOpen = $state(false);
	let creditPending = $state(false);
	let creditDollars = $state('');
	let creditNote = $state('');
	const creditCents = $derived(Math.round((parseFloat(creditDollars) || 0) * 100));

	async function submitCredit(e: SubmitEvent) {
		e.preventDefault();
		creditPending = true;
		try {
			await addCredit({ customerId: id, amount: creditCents, note: creditNote || undefined });
			toast.success('Credit added');
			creditOpen = false;
			creditDollars = creditNote = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not add credit'));
		}
		creditPending = false;
	}
</script>

<PageHeader title={c.customer.name} crumbs={[{ label: 'Customers', href: '/customers' }]}>
	{#snippet actions()}
		<StatusBadge status={c.customer.status} />
		{#if c.customer.onHold}
			<StatusBadge status="overdue" label="credit hold" />
		{/if}
		{#if dupes.length}
			<Button
				size="sm"
				variant="outline"
				class="border-amber-500/50 text-amber-600 dark:text-amber-400"
				onclick={() => (mergeOpen = true)}
				><TriangleAlert /> {dupes.length} possible duplicate{dupes.length > 1 ? 's' : ''}</Button
			>
		{:else}
			<Button
				size="sm"
				variant="outline"
				class="hidden md:inline-flex"
				onclick={() => (mergeOpen = true)}><GitMerge /> Merge</Button
			>
		{/if}
		{#if c.customer.phone}
			<Button
				size="sm"
				variant="outline"
				class="hidden md:inline-flex"
				href="tel:{c.customer.phone}"
				title="Call"><Phone /></Button
			>
			<Button
				size="sm"
				variant="outline"
				class="hidden md:inline-flex"
				href="sms:{c.customer.phone}"
				title="Text"><MessageSquare /></Button
			>
		{/if}
		{#if c.customer.email}
			<Button
				size="sm"
				variant="outline"
				class="hidden md:inline-flex"
				href="mailto:{c.customer.email}"
				title="Email"><Mail /></Button
			>
		{/if}
		<Button size="sm" variant="outline" class="hidden md:inline-flex" onclick={copyPortal}
			><Link2 /> Portal link</Button
		>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger
				class="inline-flex size-8 items-center justify-center rounded-md border hover:bg-accent md:hidden"
			>
				<EllipsisVertical class="size-4" />
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end">
				<DropdownMenu.Item onclick={() => (mergeOpen = true)}><GitMerge /> Merge</DropdownMenu.Item>
				{#if c.customer.phone}
					<DropdownMenu.Item onclick={() => (window.location.href = `tel:${c.customer.phone}`)}
						><Phone /> Call</DropdownMenu.Item
					>
					<DropdownMenu.Item onclick={() => (window.location.href = `sms:${c.customer.phone}`)}
						><MessageSquare /> Text</DropdownMenu.Item
					>
				{/if}
				{#if c.customer.email}
					<DropdownMenu.Item onclick={() => (window.location.href = `mailto:${c.customer.email}`)}
						><Mail /> Email</DropdownMenu.Item
					>
				{/if}
				<DropdownMenu.Separator />
				<DropdownMenu.Item onclick={copyPortal}><Link2 /> Portal link</DropdownMenu.Item>
				{#if c.customer.portalUserId}
					<DropdownMenu.Item disabled={revokePending} onclick={revokePortal}
						>Revoke portal</DropdownMenu.Item
					>
				{/if}
				<DropdownMenu.Item
					onclick={() =>
						(window.location.href = `/api/export/statement.csv?customer=${c.customer.id}`)}
					><Download /> Statement</DropdownMenu.Item
				>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
		{#if c.customer.portalUserId}
			<Button
				size="sm"
				variant="outline"
				class="hidden md:inline-flex"
				onclick={revokePortal}
				disabled={revokePending}>Revoke portal</Button
			>
		{/if}
		<Button size="sm" href="/jobs?new=1&customer={id}"><Wrench /> New job</Button>
		<Button
			size="sm"
			variant="outline"
			class="hidden md:inline-flex"
			href="/api/export/statement.csv?customer={c.customer.id}"
			download><Download /> Statement</Button
		>
		{#if c.customer.email}
			<Button
				size="sm"
				variant="outline"
				title="Email open-balance statement"
				disabled={stmtPending}
				onclick={emailStatementNow}><Mail /> {stmtPending ? 'Sending…' : 'Email statement'}</Button
			>
		{/if}
	{/snippet}
</PageHeader>

<div class="grid grid-cols-1 gap-6 p-4 md:p-6 xl:grid-cols-3">
	<!-- customer record + locations -->
	<div class="space-y-6">
		<Card.Root>
			<Card.Header><Card.Title class="text-base">Record</Card.Title></Card.Header>
			<Card.Content>
				<p class="mb-3 text-xs text-muted-foreground">
					{c.stats.jobCount} job{c.stats.jobCount === 1 ? '' : 's'} · {formatMoney(
						c.stats.invoiced,
						currency
					)} invoiced · {formatMoney(c.stats.collected, currency)} collected
				</p>
				{#if c.customer.tags?.length}
					<div class="mb-3 flex flex-wrap gap-1">
						{#each c.customer.tags as t (t)}
							<Badge variant="secondary">{t}</Badge>
						{/each}
					</div>
				{/if}
				<form class="space-y-4" onsubmit={saveCustomer}>
					<div class="grid grid-cols-2 gap-4">
						<Field.Field>
							<Field.Label>Type</Field.Label>
							<Select.Root type="single" bind:value={type}>
								<Select.Trigger class="w-full">{type}</Select.Trigger>
								<Select.Content>
									<Select.Item value="residential">residential</Select.Item>
									<Select.Item value="commercial">commercial</Select.Item>
								</Select.Content>
							</Select.Root>
						</Field.Field>
						<Field.Field>
							<Field.Label>Status</Field.Label>
							<Select.Root type="single" bind:value={status}>
								<Select.Trigger class="w-full">{status}</Select.Trigger>
								<Select.Content>
									<Select.Item value="active">active</Select.Item>
									<Select.Item value="inactive">inactive</Select.Item>
								</Select.Content>
							</Select.Root>
						</Field.Field>
					</div>
					{#if type === 'commercial'}
						<Field.Field>
							<Field.Label for="cd-company">Company</Field.Label>
							<Input id="cd-company" bind:value={companyName} />
						</Field.Field>
					{/if}
					<Field.Field>
						<Field.Label for="cd-name">Name</Field.Label>
						<Input id="cd-name" required bind:value={name} />
					</Field.Field>
					<Field.Field>
						<Field.Label for="cd-email">Email</Field.Label>
						<Input id="cd-email" type="email" bind:value={email} />
					</Field.Field>
					<Field.Field>
						<Field.Label for="cd-phone">Phone</Field.Label>
						<Input id="cd-phone" bind:value={phone} />
					</Field.Field>
					<Field.Field>
						<Field.Label for="cd-notes">Notes</Field.Label>
						<Textarea id="cd-notes" rows={3} bind:value={notes} />
					</Field.Field>
					<Field.Field>
						<Field.Label for="cd-source">Lead source</Field.Label>
						<Input
							id="cd-source"
							placeholder="Google, referral, yard sign…"
							bind:value={leadSource}
							list="lead-sources"
						/>
						<datalist id="lead-sources">
							<option value="Google"></option>
							<option value="Referral"></option>
							<option value="Repeat customer"></option>
							<option value="Yard sign"></option>
							<option value="Online booking"></option>
							<option value="Other"></option>
						</datalist>
					</Field.Field>
					<Field.Field>
						<Field.Label>Preferred technician</Field.Label>
						<Select.Root type="single" bind:value={preferredMemberId}>
							<Select.Trigger class="w-full"
								>{technicians.find((t) => t.id === preferredMemberId)?.name ??
									'No preference'}</Select.Trigger
							>
							<Select.Content>
								<Select.Item value="">No preference</Select.Item>
								{#each technicians as t (t.id)}
									<Select.Item value={t.id}>{t.name}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
						<p class="text-xs text-muted-foreground">Pre-fills new jobs for this customer.</p>
					</Field.Field>
					<div class="space-y-2 rounded-md border p-3">
						<p class="text-sm font-medium">Contact preferences</p>
						<label class="flex items-center gap-2 text-sm">
							<Switch bind:checked={smsOptOut} /> Don't send automated texts
						</label>
						<label class="flex items-center gap-2 text-sm">
							<Switch bind:checked={emailOptOut} /> Don't send automated emails
						</label>
						<label class="flex items-center gap-2 text-sm">
							<Switch bind:checked={onHold} /> Credit hold — block new jobs
						</label>
						<label class="flex items-center gap-2 text-sm">
							<Switch bind:checked={taxExempt} /> Tax exempt — no sales tax on invoices
						</label>
						<p class="text-xs text-muted-foreground">
							Suppresses appointment reminders, follow-ups, and invoices/estimate emails for this
							customer.
						</p>
					</div>
					<Field.Field>
						<Field.Label for="cd-tags">Tags</Field.Label>
						<Input
							id="cd-tags"
							placeholder="VIP, property manager — comma-separated"
							bind:value={tagsInput}
						/>
					</Field.Field>
					<Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
				</form>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header class="flex-row items-center justify-between">
				<Card.Title class="text-base"
					>Service locations{#if c.locations.length > 1}
						<span class="ml-1 text-xs font-normal text-muted-foreground"
							>({c.locations.length})</span
						>{/if}</Card.Title
				>
				<Button size="sm" variant="outline" onclick={() => openLocation()}><MapPin /> Add</Button>
			</Card.Header>
			<Card.Content class="space-y-2 px-4">
				{#each c.locations as l (l.id)}
					<button
						class="w-full rounded-lg border p-3 text-left text-sm transition-colors hover:bg-accent"
						onclick={() => openLocation(l)}
					>
						<div class="flex items-center justify-between">
							<span class="font-medium"
								>{l.label ? `${l.label} — ` : ''}{l.address1 || 'No address'}</span
							>
							{#if l.isPrimary}<StatusBadge status="active" label="primary" />{/if}
						</div>
						<p class="mt-1 text-xs text-muted-foreground">
							{l.city}{#if l.state}, {l.state}{/if}
							{l.zip}
						</p>
					</button>
				{:else}
					<Empty.Root class="border-0 py-2">
						<Empty.Header>
							<Empty.Media><MapPin /></Empty.Media>
							<Empty.Title class="text-sm">No service locations</Empty.Title>
						</Empty.Header>
					</Empty.Root>
				{/each}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header class="flex-row items-center justify-between">
				<Card.Title class="text-base"
					>Equipment{#if c.equipment.filter((e) => e.equipment.active && e.equipment.warrantyUntil && !eqExpired(e.equipment.warrantyUntil)).length}
						<span class="ml-1 text-xs font-normal text-muted-foreground"
							>({c.equipment.filter(
								(e) =>
									e.equipment.active &&
									e.equipment.warrantyUntil &&
									!eqExpired(e.equipment.warrantyUntil)
							).length} in warranty)</span
						>{/if}{#if c.equipment.filter((e) => e.equipment.active && e.equipment.nextServiceDue && eqExpired(e.equipment.nextServiceDue)).length}
						<span class="ml-1 text-xs font-normal text-amber-600 dark:text-amber-400"
							>· {c.equipment.filter(
								(e) =>
									e.equipment.active &&
									e.equipment.nextServiceDue &&
									eqExpired(e.equipment.nextServiceDue)
							).length} service due</span
						>{/if}</Card.Title
				>
				<Button size="sm" variant="outline" onclick={() => openEquipment()}>
					<AirVent /> Add
				</Button>
			</Card.Header>
			<Card.Content class="space-y-2 px-4">
				{#each c.equipment as e (e.equipment.id)}
					<button
						class="w-full rounded-lg border p-3 text-left text-sm transition-colors hover:bg-accent {e
							.equipment.active
							? ''
							: 'opacity-60'}"
						onclick={() => openEquipment(e)}
					>
						<div class="flex items-center justify-between gap-2">
							<span class="font-medium">{e.equipment.name}</span>
							{#if !e.equipment.active}
								<StatusBadge status="inactive" label="retired" />
							{:else if eqExpired(e.equipment.nextServiceDue)}
								<StatusBadge status="expired" label="service due" />
							{:else if eqExpired(e.equipment.warrantyUntil)}
								<StatusBadge status="expired" label="warranty expired" />
							{:else if e.equipment.warrantyUntil}
								<StatusBadge status="active" label="in warranty" />
							{/if}
						</div>
						<p class="mt-1 text-xs text-muted-foreground">
							{[e.equipment.category, e.equipment.brand, e.equipment.model]
								.filter(Boolean)
								.join(' · ') || 'Equipment'}
							{#if e.locationLabel || e.locationAddress}
								— {e.locationLabel || e.locationAddress}
							{/if}
						</p>
						{#if e.equipment.nextServiceDue}
							<p class="mt-0.5 text-xs text-muted-foreground">
								Next service {e.equipment.nextServiceDue}
							</p>
						{/if}
						{#if e.equipment.serial || e.lastService}
							<p class="mt-0.5 text-xs text-muted-foreground">
								{#if e.equipment.serial}S/N {e.equipment.serial}{/if}
								{#if e.equipment.serial && e.lastService}
									·
								{/if}
								{#if e.lastService}last serviced {formatDate(e.lastService)}{/if}
								{#if e.serviceCount}
									· {e.serviceCount} visit{e.serviceCount === 1 ? '' : 's'}{/if}
							</p>
						{/if}
					</button>
				{:else}
					<Empty.Root class="border-0 py-2">
						<Empty.Header>
							<Empty.Media><AirVent /></Empty.Media>
							<Empty.Title class="text-sm">No equipment on file</Empty.Title>
						</Empty.Header>
					</Empty.Root>
				{/each}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header class="flex-row items-center justify-between">
				<Card.Title class="text-base"
					>Maintenance schedules{#if schedules.length}
						<span class="ml-1 text-xs font-normal text-muted-foreground">({schedules.length})</span
						>{/if}</Card.Title
				>
				<Button size="sm" variant="outline" onclick={() => (addingSc = !addingSc)}>
					<Repeat /> Add
				</Button>
			</Card.Header>
			<Card.Content class="space-y-2 px-4">
				{#each schedules as sc (sc.schedule.id)}
					<div
						class="flex items-center gap-2 rounded-lg border p-3 text-sm {sc.schedule.active
							? ''
							: 'opacity-60'}"
					>
						<div class="min-w-0 flex-1">
							<p class="truncate font-medium">
								{sc.schedule.summary || sc.jobTypeName || 'Maintenance visit'}
							</p>
							<p class="mt-0.5 text-xs text-muted-foreground">
								{intervalLabel(sc.schedule.intervalDays)} · next due {formatDate(
									sc.schedule.nextDueOn
								)}
							</p>
						</div>
						<Switch
							checked={sc.schedule.active}
							onCheckedChange={(v) => toggleSchedule(sc.schedule, v)}
							aria-label="Toggle schedule"
						/>
						<Button
							variant="ghost"
							size="icon"
							class="size-7 shrink-0 text-muted-foreground"
							onclick={() => removeSchedule(sc.schedule.id)}
						>
							<Trash2 class="size-3.5" />
						</Button>
					</div>
				{:else}
					<p class="py-3 text-sm text-muted-foreground">
						No recurring schedules — e.g. a quarterly tune-up.
					</p>
				{/each}
				{#if addingSc}
					<form class="grid gap-2 border-t pt-3" onsubmit={saveSchedule}>
						<Select.Root type="single" bind:value={scType}>
							<Select.Trigger class="w-full"
								>{jobTypes.find((t) => t.id === scType)?.name ??
									'Job type (optional)'}</Select.Trigger
							>
							<Select.Content>
								{#each jobTypes.filter((t) => t.active) as t (t.id)}
									<Select.Item value={t.id}>{t.name}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
						<Input placeholder="Summary (optional)" bind:value={scSummary} />
						<div class="grid grid-cols-2 gap-2">
							<Select.Root
								type="single"
								value={String(scInterval)}
								onValueChange={(v) => (scInterval = Number(v) as typeof scInterval)}
							>
								<Select.Trigger class="w-full">{intervalLabel(scInterval)}</Select.Trigger>
								<Select.Content>
									{#each [7, 14, 30, 90, 180, 365] as d (d)}
										<Select.Item value={String(d)}>{intervalLabel(d)}</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
							<Input type="date" aria-label="First due date" bind:value={scDate} required />
						</div>
						<div class="flex gap-2">
							<Button type="submit" size="sm" disabled={!scDate}>Save</Button>
							<Button type="button" size="sm" variant="ghost" onclick={() => (addingSc = false)}
								>Cancel</Button
							>
						</div>
					</form>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header class="flex-row items-center justify-between">
				<Card.Title class="text-base"
					>Communications{#if c.communications.length}
						<span class="ml-1 text-xs font-normal text-muted-foreground"
							>({c.communications.length} logged)</span
						>{/if}</Card.Title
				>
				<div class="flex gap-1">
					{#each [['all', 'All'], ['email', 'Email'], ['sms', 'SMS']] as [v, label] (v)}
						<Button
							size="sm"
							variant={commFilter === v ? 'secondary' : 'ghost'}
							onclick={() => (commFilter = v as typeof commFilter)}>{label}</Button
						>
					{/each}
				</div>
				{#if c.customer.phone}
					<Button size="sm" variant="outline" onclick={() => (textOpen = true)}
						><MessageSquare /> Text</Button
					>
				{/if}
			</Card.Header>
			<Card.Content class="px-4">
				{#each c.communications.filter((n) => commFilter === 'all' || (commFilter === 'sms' ? n.kind.includes('sms') : !n.kind.includes('sms'))) as n (n.id)}
					<div
						class="flex items-baseline justify-between gap-3 border-b py-2 text-sm last:border-0"
					>
						<div class="min-w-0">
							<p class="truncate font-medium">{kindLabel(n.kind)}</p>
							<p class="truncate text-xs text-muted-foreground">
								{n.kind === 'inbound_sms' ? 'from' : 'to'}
								{n.recipient.split(':')[0]}
								{n.kind === 'inbound_sms' ? `— ${n.recipient.split(':').slice(1).join(':')}` : ''}
							</p>
						</div>
						<span class="shrink-0 text-xs text-muted-foreground">{formatRelative(n.createdAt)}</span
						>
					</div>
				{:else}
					<Empty.Root class="border-0 py-2">
						<Empty.Header>
							<Empty.Media><Mails /></Empty.Media>
							<Empty.Title class="text-sm">No automated emails or texts yet</Empty.Title>
						</Empty.Header>
					</Empty.Root>
				{/each}
			</Card.Content>
		</Card.Root>
	</div>

	<!-- activity: jobs / agreements / estimates / billing -->
	<div class="space-y-6 xl:col-span-2">
		<Card.Root>
			<Card.Header class="flex-row items-center justify-between">
				<Card.Title class="text-base"
					>Jobs{#if c.jobs.filter((j) => !['done', 'cancelled'].includes(j.job.status)).length}
						<span class="ml-1 text-xs font-normal text-muted-foreground"
							>({c.jobs.filter((j) => !['done', 'cancelled'].includes(j.job.status)).length} open)</span
						>{/if}{#if c.jobs
						.filter((j) => j.job.status === 'done' && j.job.completedAt)
						.map((j) => new Date(j.job.completedAt!).getTime())
						.reduce((a, b) => Math.max(a, b), 0)}
						{@const lastVisit = Math.max(
							...c.jobs
								.filter((j) => j.job.status === 'done' && j.job.completedAt)
								.map((j) => new Date(j.job.completedAt!).getTime())
						)}
						<span class="ml-1 text-xs font-normal text-muted-foreground"
							>· last visit {Math.max(1, Math.floor((Date.now() - lastVisit) / 86400000))}d ago</span
						>{/if}</Card.Title
				>
				<div class="flex items-center gap-3">
					{#if c.nextJob}
						<a
							href="/jobs/{c.nextJob.job.id}"
							class="text-xs text-muted-foreground underline-offset-2 hover:underline"
							>Next: {localDate(c.nextJob.job.startsAt!, tz)}
							{localTime(c.nextJob.job.startsAt!, tz)}</a
						>
					{/if}
					<Button size="sm" variant="outline" href="/jobs?new=1&customer={id}"><Plus /> New</Button>
				</div>
			</Card.Header>
			<Card.Content class="overflow-x-auto px-0">
				<Table.Root>
					<Table.Body>
						{#each c.jobs as j (j.job.id)}
							<Table.Row class="cursor-pointer" onclick={() => goto(`/jobs/${j.job.id}`)}>
								<Table.Cell class="pl-6 font-medium">
									J-{j.job.number}
									{j.job.summary || j.jobTypeName}
								</Table.Cell>
								<Table.Cell class="text-muted-foreground"
									>{j.job.startsAt
										? `${localDate(j.job.startsAt, tz)} ${localTime(j.job.startsAt, tz)}`
										: '—'}</Table.Cell
								>
								<Table.Cell class="pr-6 text-right"
									><StatusBadge status={j.job.status} /></Table.Cell
								>
							</Table.Row>
						{:else}
							<Table.Row
								><Table.Cell class="pl-6 text-muted-foreground">No jobs yet.</Table.Cell></Table.Row
							>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>

		<div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
			<Card.Root>
				<Card.Header class="flex-row items-center justify-between">
					<Card.Title class="text-base"
						>Agreements{#if c.agreements.filter((a) => a.agreement.status === 'active').length}
							<span class="ml-1 text-xs font-normal text-muted-foreground"
								>({c.agreements.filter((a) => a.agreement.status === 'active').length} active)</span
							>{/if}</Card.Title
					>
					<Button size="sm" variant="outline" href="/agreements?new=1&customer={id}"
						><Plus /> New</Button
					>
				</Card.Header>
				<Card.Content class="space-y-2 px-4">
					{#each c.agreements as a (a.agreement.id)}
						<div class="rounded-lg border p-3 text-sm">
							<div class="flex items-center justify-between">
								<span class="font-medium">{a.planName}</span>
								<StatusBadge status={a.agreement.status} />
							</div>
							<p class="mt-1 text-xs text-muted-foreground">
								{formatMoney(a.amount, currency)}/{a.interval}
								· since {formatDate(a.agreement.startsAt)}
								{#if a.agreement.nextChargeAt}· next {formatDate(a.agreement.nextChargeAt)}{/if}
							</p>
						</div>
					{:else}
						<p class="py-3 text-sm text-muted-foreground">No service agreements.</p>
					{/each}
				</Card.Content>
			</Card.Root>

			<Card.Root>
				<Card.Header class="flex-row items-center justify-between">
					<Card.Title class="text-base"
						>Estimates{#if c.estimates.filter( (e) => ['approved', 'converted'].includes(e.status) ).length}
							<span class="ml-1 text-xs font-normal text-muted-foreground"
								>({c.estimates.filter((e) => ['approved', 'converted'].includes(e.status)).length}
								won)</span
							>{/if}
						{#if c.openEstimates?.n}
							<span class="ml-1 text-xs font-normal text-muted-foreground"
								>({c.openEstimates.n} open · {formatMoney(c.openEstimates.total, currency)})</span
							>{/if}</Card.Title
					>
					<Button size="sm" variant="outline" href="/estimates?new=1&customer={id}"
						><Plus /> New</Button
					>
				</Card.Header>
				<Card.Content class="overflow-x-auto px-0">
					<Table.Root>
						<Table.Body>
							{#each c.estimates as e (e.id)}
								<Table.Row class="cursor-pointer" onclick={() => goto(`/estimates/${e.id}`)}>
									<Table.Cell class="pl-6 font-medium">E-{e.number}</Table.Cell>
									<Table.Cell class="text-muted-foreground">{formatDate(e.createdAt)}</Table.Cell>
									<Table.Cell class="pr-6 text-right"><StatusBadge status={e.status} /></Table.Cell>
								</Table.Row>
							{:else}
								<Table.Row
									><Table.Cell class="pl-6 text-muted-foreground">No estimates.</Table.Cell
									></Table.Row
								>
							{/each}
						</Table.Body>
					</Table.Root>
				</Card.Content>
			</Card.Root>
		</div>

		<Card.Root>
			<Card.Header class="flex-row items-center justify-between">
				<Card.Title class="text-base">Billing</Card.Title>
				<div class="flex items-center gap-2">
					{#if c.customer.status === 'active'}
						<Button
							size="sm"
							variant="outline"
							onclick={() => {
								payDollars = '';
								payOpen = true;
							}}>Record payment</Button
						>
						<Button
							size="sm"
							variant="outline"
							onclick={() => {
								creditDollars = '';
								creditOpen = true;
							}}>Add credit</Button
						>
					{/if}
					<Button size="sm" variant="ghost" href="/billing?customer={id}">All billing</Button>
				</div>
			</Card.Header>
			<Card.Content>
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div class="rounded-lg bg-muted/50 p-3">
						<p class="text-xs text-muted-foreground">Open balance</p>
						<p class="text-xl font-semibold tabular-nums">
							{formatMoney(
								c.charges.reduce(
									(sum, ch) => sum + (ch.charge.status === 'open' ? ch.charge.amount - ch.paid : 0),
									0
								),
								currency
							)}
						</p>
					</div>
					<div class="rounded-lg bg-muted/50 p-3">
						<p class="text-xs text-muted-foreground">Customer since</p>
						<p class="text-xl font-semibold tabular-nums">{formatDate(c.customer.createdAt)}</p>
					</div>
					<div class="rounded-lg bg-muted/50 p-3">
						<p class="text-xs text-muted-foreground">Lifetime payments</p>
						<p class="text-xl font-semibold tabular-nums">
							{formatMoney(
								c.payments.reduce((sum, p) => sum + p.amount, 0),
								currency
							)}
						</p>
					</div>
				</div>
				<Separator class="my-4" />
				<ul class="space-y-2 text-sm">
					{#each [...c.charges
							.filter((ch) => ch.charge.status === 'open')
							.map( (ch) => ({ key: `ch-${ch.charge.id}`, d: new Date(`${ch.charge.dueDate}T00:00:00Z`), label: ch.charge.description || 'Charge', status: ch.charge.status, cents: ch.charge.amount - ch.paid }) ), ...c.payments.map( (p) => ({ key: `p-${p.id}`, d: p.paidAt, label: `Payment — ${p.method}`, status: 'paid', cents: -p.amount }) )]
						.sort((a, b) => b.d.getTime() - a.d.getTime())
						.slice(0, 10) as row (row.key)}
						<li class="flex items-center justify-between">
							<span class="truncate"
								>{row.label}
								<span class="text-xs text-muted-foreground">{formatDate(row.d)}</span></span
							>
							<span class="tabular-nums {row.cents < 0 ? 'text-emerald-600' : ''}"
								>{row.cents < 0 ? '−' : ''}{formatMoney(Math.abs(row.cents), currency)}</span
							>
						</li>
					{:else}
						<li class="text-muted-foreground">No billing activity.</li>
					{/each}
				</ul>
			</Card.Content>
		</Card.Root>
	</div>
</div>

<!-- location dialog -->
<Dialog.Root bind:open={locOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{locId ? 'Edit' : 'Add'} service location</Dialog.Title>
			<Dialog.Description
				>Where the work happens — an address plus optional on-site contact.</Dialog.Description
			>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={saveLocation}>
			<Field.Field>
				<Field.Label for="l-label">Label</Field.Label>
				<Input id="l-label" bind:value={label} placeholder="Home, Warehouse, Unit 4…" />
			</Field.Field>
			<Field.Field>
				<Field.Label for="l-addr1">Address</Field.Label>
				<Input id="l-addr1" bind:value={address1} placeholder="Street" />
			</Field.Field>
			<div class="grid grid-cols-3 gap-4">
				<Input bind:value={city} placeholder="City" />
				<Input bind:value={addrState} placeholder="State" />
				<Input bind:value={zip} placeholder="ZIP" />
			</div>
			<Field.Field>
				<Field.Label for="l-access">Access notes</Field.Label>
				<Input id="l-access" bind:value={accessNotes} placeholder="Gate code, key location…" />
			</Field.Field>
			<Dialog.Footer>
				<Button type="submit" disabled={locPending}>{locPending ? 'Saving…' : 'Save'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={creditOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Add account credit</Dialog.Title>
			<Dialog.Description>
				A negative charge — lowers {c.customer.name}'s open balance automatically.
			</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={submitCredit}>
			<Field.Field>
				<Field.Label for="cr-amt">Amount</Field.Label>
				<Input
					id="cr-amt"
					type="number"
					step="0.01"
					min="0.01"
					required
					bind:value={creditDollars}
					placeholder="0.00"
				/>
			</Field.Field>
			<Field.Field>
				<Field.Label for="cr-note">Note</Field.Label>
				<Input id="cr-note" bind:value={creditNote} placeholder="Optional — e.g. goodwill" />
			</Field.Field>
			<Dialog.Footer>
				<Button type="submit" disabled={creditPending || creditCents <= 0}
					>{creditPending
						? 'Saving…'
						: `Add ${creditCents ? formatMoney(creditCents, currency) : 'credit'}`}</Button
				>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<!-- equipment dialog -->
<Dialog.Root bind:open={eqOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{eqId ? 'Edit' : 'Add'} equipment</Dialog.Title>
			<Dialog.Description
				>Installed equipment at a site — jobs can link to it for service history.</Dialog.Description
			>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={saveEquipment}>
			<Field.Field>
				<Field.Label for="eq-name">Name</Field.Label>
				<Input id="eq-name" required bind:value={eqName} placeholder="Upstairs AC, Water heater…" />
			</Field.Field>
			<Field.Field>
				<Field.Label>Location</Field.Label>
				<Select.Root type="single" bind:value={eqLocationId}>
					<Select.Trigger class="w-full"
						>{c.locations.find((l) => l.id === eqLocationId)
							? `${c.locations.find((l) => l.id === eqLocationId)!.label ? `${c.locations.find((l) => l.id === eqLocationId)!.label} — ` : ''}${c.locations.find((l) => l.id === eqLocationId)!.address1}`
							: 'Customer-wide'}</Select.Trigger
					>
					<Select.Content>
						{#each c.locations as l (l.id)}
							<Select.Item value={l.id}
								>{l.label ? `${l.label} — ` : ''}{l.address1}, {l.city}</Select.Item
							>
						{/each}
					</Select.Content>
				</Select.Root>
			</Field.Field>
			<div class="grid grid-cols-2 gap-4">
				<Field.Field>
					<Field.Label for="eq-cat">Category</Field.Label>
					<Input id="eq-cat" bind:value={eqCategory} placeholder="HVAC, Plumbing…" />
				</Field.Field>
				<Field.Field>
					<Field.Label for="eq-brand">Brand</Field.Label>
					<Input id="eq-brand" bind:value={eqBrand} placeholder="Carrier, Rheem…" />
				</Field.Field>
			</div>
			<div class="grid grid-cols-2 gap-4">
				<Field.Field>
					<Field.Label for="eq-model">Model</Field.Label>
					<Input id="eq-model" bind:value={eqModel} />
				</Field.Field>
				<Field.Field>
					<Field.Label for="eq-serial">Serial #</Field.Label>
					<Input id="eq-serial" bind:value={eqSerial} />
				</Field.Field>
			</div>
			<div class="grid grid-cols-2 gap-4">
				<Field.Field>
					<Field.Label for="eq-inst">Installed</Field.Label>
					<Input id="eq-inst" type="date" bind:value={eqInstalled} />
				</Field.Field>
				<Field.Field>
					<Field.Label for="eq-war">Warranty until</Field.Label>
					<Input id="eq-war" type="date" bind:value={eqWarranty} />
				</Field.Field>
			</div>
			<div class="grid grid-cols-2 gap-4">
				<Field.Field>
					<Field.Label for="eq-due">Next service due</Field.Label>
					<Input id="eq-due" type="date" bind:value={eqServiceDue} />
				</Field.Field>
			</div>
			<Field.Field>
				<Field.Label for="eq-notes">Notes</Field.Label>
				<Textarea id="eq-notes" rows={2} bind:value={eqNotes} />
			</Field.Field>
			{#if eqId}
				<div>
					<p class="pb-1.5 text-sm font-medium">Service history</p>
					{#await getEquipmentJobs(eqId) then eqJobs}
						<div class="max-h-40 space-y-1 overflow-y-auto text-sm">
							{#each eqJobs.slice().reverse() as ej (ej.job.id)}
								<div class="flex items-center justify-between gap-2">
									<a
										href="/jobs/{ej.job.id}"
										class="truncate hover:underline"
										data-sveltekit-preload-data="tap"
										>J-{ej.job.number} {ej.job.summary || ej.jobTypeName || 'Visit'}</a
									>
									<span class="shrink-0 text-xs text-muted-foreground"
										>{ej.job.startsAt ? formatDate(ej.job.startsAt) : ej.job.status}</span
									>
								</div>
							{:else}
								<p class="text-xs text-muted-foreground">No jobs on this unit yet.</p>
							{/each}
						</div>
					{/await}
				</div>
				<div class="flex items-center gap-2 text-sm">
					<Switch bind:checked={eqActive} id="eq-active" />
					<Field.Label for="eq-active" class="font-normal"
						>{eqActive ? 'Active' : 'Retired — hidden from job pickers'}</Field.Label
					>
				</div>
			{/if}
			<Dialog.Footer class="justify-between sm:justify-between">
				{#if eqId && eqActive}
					<Button
						variant="ghost"
						type="button"
						onclick={() => goto(`/jobs?new=1&customer=${id}&equipment=${eqId}`)}
						><Wrench /> Book service</Button
					>
				{:else}
					<span></span>
				{/if}
				<Button type="submit" disabled={eqPending}>{eqPending ? 'Saving…' : 'Save'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<!-- record payment dialog -->
<Dialog.Root bind:open={payOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Record payment</Dialog.Title>
			<Dialog.Description>
				Collected outside Tredaro — applies to the oldest open charges first.
			</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={submitPayment}>
			<Field.Field>
				<Field.Label for="p-amt">Amount</Field.Label>
				<Input
					id="p-amt"
					type="number"
					step="0.01"
					min="0.01"
					required
					bind:value={payDollars}
					placeholder="0.00"
				/>
			</Field.Field>
			<Field.Field>
				<Field.Label>Method</Field.Label>
				<Select.Root type="single" bind:value={payMethod}>
					<Select.Trigger class="w-full">{payMethod}</Select.Trigger>
					<Select.Content>
						{#each ['cash', 'card', 'bank', 'other'] as m (m)}
							<Select.Item value={m}>{m}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</Field.Field>
			<Field.Field>
				<Field.Label for="p-note">Note</Field.Label>
				<Input id="p-note" bind:value={payNote} placeholder="Optional" />
			</Field.Field>
			<Dialog.Footer>
				<Button type="submit" disabled={payPending || payCents <= 0}
					>{payPending
						? 'Saving…'
						: `Record ${payCents ? formatMoney(payCents, currency) : ''}`}</Button
				>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={mergeOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Merge into {c.customer.name}</Dialog.Title>
			<Dialog.Description>
				Pick the duplicate to merge. Its jobs, invoices, charges, payments, agreements, equipment
				and locations move to {c.customer.name}, and the duplicate is deleted — this can't be
				undone.
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-2">
			{#each dupes as d (d.customer.id)}
				<button
					type="button"
					class="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors {mergeSource ===
					d.customer.id
						? 'border-primary bg-primary/5'
						: 'hover:bg-accent/50'}"
					onclick={() => (mergeSource = d.customer.id)}
				>
					<span
						class="mt-1 size-3 shrink-0 rounded-full border {mergeSource === d.customer.id
							? 'border-primary bg-primary'
							: 'border-muted-foreground/40'}"
					></span>
					<span class="min-w-0 flex-1">
						<span class="block font-medium">
							{d.customer.name}
							{#if d.customer.companyName}
								<span class="text-muted-foreground">· {d.customer.companyName}</span>
							{/if}
						</span>
						<span class="block text-xs text-muted-foreground">
							{d.match}
							{#if d.customer.email}
								· {d.customer.email}{/if}
							{#if d.customer.phone}
								· {d.customer.phone}{/if}
						</span>
					</span>
					<StatusBadge status={d.customer.status} />
				</button>
			{:else}
				<p class="text-sm text-muted-foreground">
					No duplicates found — no other customer shares this one's email, phone number, or name.
				</p>
			{/each}
		</div>
		{#if dupes.length}
			<Dialog.Footer>
				<Button variant="destructive" disabled={!mergeSource || mergePending} onclick={doMerge}>
					{mergePending
						? 'Merging…'
						: `Merge ${mergeTarget?.customer.name ?? '…'} into this customer`}
				</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<!-- manual text -->
<Dialog.Root bind:open={textOpen}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Text {c.customer.name}</Dialog.Title>
			<Dialog.Description>
				Sends an SMS to {c.customer.phone} from your company's number.
			</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={sendText}>
			<Field.Field>
				<Field.Label for="cust-text">Message</Field.Label>
				<Textarea
					id="cust-text"
					rows={3}
					maxlength={500}
					bind:value={textMsg}
					placeholder="Running about 20 minutes behind — see you soon"
				/>
			</Field.Field>
			<Dialog.Footer>
				<Button type="submit" disabled={textPending || !textMsg.trim()}
					>{textPending ? 'Sending…' : 'Send text'}</Button
				>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
