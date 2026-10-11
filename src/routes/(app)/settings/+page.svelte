<script lang="ts">
	import Building2 from '@lucide/svelte/icons/building-2';
	import CalendarX2 from '@lucide/svelte/icons/calendar-x-2';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { ApiPermissions } from '#lib/api-permissions.ts';
	import PageHeader from '#lib/components/app/page-header.svelte';
	import MoneyInput from '#lib/components/app/money-input.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
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
		testWebhook,
		getWebhookDeliveries,
		retryWebhookDelivery,
		getStaff,
		updateCommission,
		updateLaborCost,
		updateLicense,
		updateMemberPhone,
		updateOvertimePct,
		setDispatchVisible,
		setMemberColor,
		setStaffAlerts,
		setMemberSkills,
		getSmsOutbox,
		seedDemo,
		sendTestEmail,
		sendTestSms
	} from '#lib/remote/workspace.remote.ts';
	import {
		getJobTypes,
		createJobType,
		updateJobType,
		getTechnicians,
		getTimeOff,
		addTimeOff,
		deleteTimeOff,
		setTimeOffStatus
	} from '#lib/remote/jobs.remote.ts';
	import { getInventory, getJobTypeKits, setJobTypeKit } from '#lib/remote/inventory.remote.ts';
	import {
		getPaymentProviders,
		toggleProvider,
		connectProvider,
		refreshProvider
	} from '#lib/remote/payments.remote.ts';
	import { getApiKeys, createApiKey, deleteApiKey } from '#lib/remote/api-keys.remote.ts';
	import { getAiStatus, aiChecklistDraft } from '#lib/remote/ai.remote.ts';
	import { API_RESOURCES } from '#lib/api-permissions.ts';
	import { errMsg, formatDate, formatRelative } from '#lib/format.ts';
	import { tour } from '#lib/components/app/tour.svelte.ts';
	import Plus from '@lucide/svelte/icons/plus';
	import Copy from '@lucide/svelte/icons/copy';
	import Trash from '@lucide/svelte/icons/trash-2';
	import Send from '@lucide/svelte/icons/send';
	import History from '@lucide/svelte/icons/history';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import GraduationCap from '@lucide/svelte/icons/graduation-cap';
	import Sun from '@lucide/svelte/icons/sun';
	import Moon from '@lucide/svelte/icons/moon';
	import MonitorSmartphone from '@lucide/svelte/icons/monitor-smartphone';
	import Download from '@lucide/svelte/icons/download';
	import { userPrefersMode, setMode } from 'mode-watcher';

	let settings = $state(await getSettings());
	const aiStatus = await getAiStatus();
	const smsLog = await getSmsOutbox();
	let offices = $state(await getOffices());
	let webhooks = $state(await getWebhooks());
	let apiKeys = $state(await getApiKeys());
	let providerList = $state(await getPaymentProviders());
	const staff = await getStaff();
	let pending = $state(false);
	const todayStr = new Date().toISOString().slice(0, 10);
	const thirtyDaysOut = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);

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
	async function setTimeOff(input: { id: string; status: 'approved' | 'denied' }) {
		try {
			const res = await setTimeOffStatus(input).updates(getTimeOff);
			if (input.status === 'approved' && res.conflicts.length > 0) {
				toast.warning(
					`Approved — but ${res.conflicts.length} job${res.conflicts.length === 1 ? '' : 's'} still scheduled in that window (${res.conflicts
						.map((c) => `J-${c.number}`)
						.join(', ')}). Reassign on Dispatch.`,
					{ duration: 8000 }
				);
			} else {
				toast.success(input.status === 'approved' ? 'Time off approved' : 'Request denied');
			}
		} catch (err) {
			toast.error(errMsg(err, 'Could not update request'));
		}
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
	let jtAiPending = $state(false);
	async function draftJtChecklist() {
		jtAiPending = true;
		try {
			const r = await aiChecklistDraft({ name: jtName, context: jtDescription });
			if (r.steps.length) {
				jtChecklist = r.steps.join('\n');
				toast.success(`Drafted ${r.steps.length} steps`);
			} else toast.info('No steps drafted — try a more descriptive name');
		} catch (err) {
			toast.error(errMsg(err, 'Could not draft checklist'));
		}
		jtAiPending = false;
	}
	let jtDescription = $state('');
	let jtDuration = $state(60);
	let jtWarrantyDays = $state(0);
	let jtAmount = $state<number | null>(null);
	let jtRate = $state<number | null>(null);
	let jtTech = $state('');
	let jtChecklist = $state('');
	let jtReqChecklist = $state(false);
	let jtReqPhoto = $state(false);
	let jtReqSignature = $state(false);
	let jtReqDoc = $state(false);
	let jtReqTimer = $state(false);
	let jtReqHelper = $state(false);
	let jtBookable = $state(true);
	let jtActive = $state(true);

	function openJt(t?: (typeof jobTypes)[number]) {
		jtEdit = t ?? null;
		jtName = t?.name ?? '';
		jtDescription = t?.description ?? '';
		jtDuration = t?.durationMin ?? 60;
		jtWarrantyDays = t?.laborWarrantyDays ?? 0;
		jtAmount = t?.defaultAmount ?? null;
		jtRate = t?.hourlyRate ?? null;
		jtTech = t?.technicianId ?? '';
		jtChecklist = (t?.checklist ?? []).join('\n');
		jtReqChecklist = t?.requireChecklist ?? false;
		jtReqPhoto = t?.requirePhoto ?? false;
		jtReqSignature = t?.requireSignature ?? false;
		jtReqDoc = t?.requireDocument ?? false;
		jtReqTimer = t?.requireTimer ?? false;
		jtReqHelper = t?.requiresHelper ?? false;
		jtBookable = t?.bookable ?? true;
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
			laborWarrantyDays: jtWarrantyDays,
			defaultAmount: jtAmount,
			hourlyRate: jtRate,
			technicianId: jtTech || null,
			checklist: jtChecklist
				.split('\n')
				.map((l) => l.trim())
				.filter(Boolean),
			requireChecklist: jtReqChecklist,
			requirePhoto: jtReqPhoto,
			requireSignature: jtReqSignature,
			requireDocument: jtReqDoc,
			requireTimer: jtReqTimer,
			requiresHelper: jtReqHelper,
			bookable: jtBookable,
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

	// ------- material kits -------
	let kits = $state(await getJobTypeKits());
	const invRows = await getInventory();
	let kitOpen = $state(false);
	let kitType: (typeof jobTypes)[number] | null = $state(null);
	let kitRows = $state<{ inventoryItemId: string; qty: number }[]>([]);
	let kitPending = $state(false);
	const kitCount = $derived(
		kits.reduce<Record<string, number>>((m, k) => {
			m[k.jobTypeId] = (m[k.jobTypeId] ?? 0) + 1;
			return m;
		}, {})
	);
	function openKit(t: (typeof jobTypes)[number]) {
		kitType = t;
		kitRows = kits
			.filter((k) => k.jobTypeId === t.id)
			.map((k) => ({ inventoryItemId: k.inventoryItemId, qty: k.qty }));
		kitOpen = true;
	}
	async function saveKit() {
		if (!kitType) return;
		kitPending = true;
		try {
			const items = kitRows.filter((r) => r.inventoryItemId && r.qty > 0);
			await setJobTypeKit({ jobTypeId: kitType.id, items }).updates(getJobTypeKits);
			kits = await getJobTypeKits();
			toast.success(`Kit saved — ${items.length} item${items.length === 1 ? '' : 's'}`);
			kitOpen = false;
		} catch (err) {
			toast.error(errMsg(err, 'Could not save kit'));
		}
		kitPending = false;
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
	let emailNotifications = $state(settings.emailNotifications);
	let smsNotifications = $state(settings.smsNotifications);
	let smsSignature = $state(settings.smsSignature);
	let staffDigest = $state(settings.staffDigest);
	let invoiceTermsDays = $state(settings.invoiceTermsDays);
	let estimateFooter = $state(settings.estimateFooter);
	let invoiceFooter = $state(settings.invoiceFooter);
	let estimateValidDays = $state(settings.estimateValidDays);
	let autoInvoiceOnComplete = $state(settings.autoInvoiceOnComplete);
	let autoSendReport = $state(settings.autoSendReport);
	let bookingNoticeDays = $state(settings.bookingNoticeDays);
	let bookingMaxDaysAhead = $state(settings.bookingMaxDaysAhead);
	let bookingDailyLimit = $state(settings.bookingDailyLimit);
	let bookingDeposit = $state(settings.bookingDeposit);
	let bookingEnabled = $state(settings.bookingEnabled);
	let taxRatePct = $state(settings.taxRateBps / 100);
	let lateFeeDollars = $state(settings.lateFeeCents / 100);
	let depositPct = $state(settings.estimateDepositPct);
	let laborRounding = $state(settings.laborRoundingMin);
	let materialsMarkup = $state(settings.materialsMarkupBps / 100);
	let serviceZips = $state(settings.serviceZips);
	let licenseNumber = $state(settings.licenseNumber);
	let logoUrl = $state(settings.logoUrl);
	let businessHours = $state(settings.businessHours);
	let bookingMessage = $state(settings.bookingMessage);
	let bookingReview = $state(settings.bookingReview);
	let bookingBlackouts = $state(settings.bookingBlackouts);
	let reminderHours = $state(settings.reminderHours);
	const bookUrl = $derived(`${page.url.origin}/book/${page.data.org.slug}`);
	let testSmsTo = $state('');
	let testPending = $state(false);
	async function testEmail() {
		testPending = true;
		try {
			await sendTestEmail({});
			toast.success('Test email sent (check your inbox/spam)');
		} catch (err) {
			toast.error(errMsg(err, 'Could not send test email'));
		}
		testPending = false;
	}
	async function testSms() {
		testPending = true;
		try {
			await sendTestSms({ to: testSmsTo.trim() });
			toast.success('Test text sent');
		} catch (err) {
			toast.error(errMsg(err, 'Could not send test text'));
		}
		testPending = false;
	}
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
				publicPage,
				emailNotifications,
				smsNotifications,
				smsSignature,
				staffDigest,
				invoiceTermsDays,
				estimateFooter,
				invoiceFooter,
				estimateValidDays,
				autoInvoiceOnComplete,
				autoSendReport,
				bookingNoticeDays,
				bookingMaxDaysAhead,
				bookingDailyLimit,
				bookingDeposit: bookingDeposit ?? 0,
				bookingEnabled,
				taxRateBps: Math.round((taxRatePct || 0) * 100),
				lateFeeCents: Math.round((lateFeeDollars || 0) * 100),
				estimateDepositPct: Math.round(depositPct || 0),
				laborRoundingMin: Math.round(laborRounding || 0),
				materialsMarkupBps: Math.round((materialsMarkup || 0) * 100),
				serviceZips,
				licenseNumber,
				logoUrl,
				businessHours,
				bookingMessage,
				bookingReview,
				bookingBlackouts,
				reminderHours: Math.min(168, Math.max(1, Math.round(reminderHours || 36)))
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
	async function saveCommission(s: (typeof staff)[number], el: Event) {
		const pct = Number((el.target as HTMLInputElement).value) || 0;
		try {
			await updateCommission({ memberId: s.id, commissionPct: pct }).updates(getStaff);
			toast.success(`Commission set to ${pct}%`);
		} catch (err) {
			toast.error(errMsg(err, 'Could not save'));
		}
	}
	async function saveLaborCost(s: (typeof staff)[number], el: Event) {
		const dollars = Number((el.target as HTMLInputElement).value) || 0;
		try {
			await updateLaborCost({
				memberId: s.id,
				laborCostCents: Math.round(dollars * 100)
			}).updates(getStaff);
			toast.success(`Labor cost set`);
		} catch (err) {
			toast.error(errMsg(err, 'Could not save'));
		}
	}

	async function saveLicense(s: (typeof staff)[number]) {
		try {
			await updateLicense({
				memberId: s.id,
				licenseNo: s.licenseNo ?? '',
				licenseExpiry: s.licenseExpiry ?? ''
			}).updates(getStaff);
			toast.success('License saved');
		} catch (err) {
			toast.error(errMsg(err, 'Could not save'));
		}
	}

	async function saveOvertime(s: (typeof staff)[number], el: Event) {
		const pct = Math.round(Number((el.target as HTMLInputElement).value) || 0);
		try {
			await updateOvertimePct({ memberId: s.id, overtimePct: pct }).updates(getStaff);
			toast.success(`Overtime set to ${pct}%`);
		} catch (err) {
			toast.error(errMsg(err, 'Could not save'));
		}
	}

	async function saveMemberPhone(s: (typeof staff)[number], el: Event) {
		try {
			await updateMemberPhone({
				memberId: s.id,
				phone: (el.target as HTMLInputElement).value
			}).updates(getStaff);
			toast.success('SMS number saved');
		} catch (err) {
			toast.error(errMsg(err, 'Could not save'));
		}
	}

	async function saveStaffAlerts(s: (typeof staff)[number], on: boolean) {
		try {
			await setStaffAlerts({ memberId: s.id, staffAlerts: on }).updates(getStaff);
			toast.success('Saved');
		} catch (err) {
			toast.error(errMsg(err, 'Could not save'));
		}
	}

	function skillIds(s: (typeof staff)[number]) {
		return s.skillTags ? s.skillTags.split(',').filter(Boolean) : [];
	}
	async function saveDispatchVisible(s: (typeof staff)[number], on: boolean) {
		try {
			await setDispatchVisible({ memberId: s.id, dispatchVisible: on }).updates(getStaff);
			toast.success(on ? `${s.name} is on the dispatch board` : `${s.name} hidden from dispatch`);
		} catch (err) {
			toast.error(errMsg(err, 'Could not update'));
		}
	}

	async function saveMemberColor(s: (typeof staff)[number], color: string) {
		try {
			await setMemberColor({ memberId: s.id, color }).updates(getStaff);
			toast.success('Dispatch color saved');
		} catch (err) {
			toast.error(errMsg(err, 'Could not save color'));
		}
	}

	async function setSkills(s: (typeof staff)[number], ids: string[]) {
		try {
			await setMemberSkills({ memberId: s.id, jobTypeIds: ids }).updates(getStaff);
			toast.success('Skills saved');
		} catch (err) {
			toast.error(errMsg(err, 'Could not save'));
		}
	}
	function toggleSkill(s: (typeof staff)[number], typeId: string) {
		const ids = skillIds(s);
		setSkills(s, ids.includes(typeId) ? ids.filter((i) => i !== typeId) : [...ids, typeId]);
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
	let testingHook = $state('');
	let hookHistory = $state<Record<string, Awaited<ReturnType<typeof getWebhookDeliveries>>>>({});
	async function toggleHookHistory(id: string) {
		if (hookHistory[id]) {
			const { [id]: _, ...rest } = hookHistory;
			hookHistory = rest;
			return;
		}
		hookHistory = { ...hookHistory, [id]: await getWebhookDeliveries(id) };
	}
	let retryingDelivery = $state('');
	async function retryDelivery(hookId: string, deliveryId: string) {
		retryingDelivery = deliveryId;
		try {
			const status = await retryWebhookDelivery(deliveryId);
			toast[status > 0 && status < 400 ? 'success' : 'error'](
				status > 0 ? `Redelivered — HTTP ${status}` : 'Retry failed — endpoint unreachable'
			);
			hookHistory = { ...hookHistory, [hookId]: await getWebhookDeliveries(hookId) };
			webhooks = await getWebhooks();
		} catch (err) {
			toast.error(errMsg(err, 'Retry failed'));
		}
		retryingDelivery = '';
	}
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
			<Card.Root class="max-w-3xl">
				<Card.Header>
					<Card.Title class="text-base">Workspace</Card.Title>
					<Card.Description>Timezone, currency and the public booking page.</Card.Description>
				</Card.Header>
				<Card.Content>
					<form class="space-y-4" onsubmit={saveSettings}>
						<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
						<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
							<Field.Label for="lic">License / registration #</Field.Label>
							<Input id="lic" bind:value={licenseNumber} placeholder="CAC-123456" />
							<p class="text-xs text-muted-foreground">
								Printed on estimates and work orders. Leave empty to hide.
							</p>
						</Field.Field>
						<Field.Field>
							<Field.Label for="logo">Logo URL</Field.Label>
							<Input id="logo" type="url" bind:value={logoUrl} placeholder="https://…/logo.png" />
							<Field.Description
								>Shown on print documents and the public estimate page.</Field.Description
							>
						</Field.Field>
						<Field.Field>
							<Field.Label for="hours">Business hours</Field.Label>
							<Input
								id="hours"
								bind:value={businessHours}
								placeholder="Mon–Fri 8am–5pm, Sat 9am–1pm"
								class="max-w-72"
							/>
							<Field.Description>Shown on the public booking page.</Field.Description>
						</Field.Field>
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
						<div class="space-y-3 rounded-lg border p-3 text-sm">
							<p class="font-medium">Automated notifications</p>
							<div class="flex items-center justify-between">
								<div>
									<p>Customer emails</p>
									<p class="text-xs text-muted-foreground">
										Appointment reminders, follow-ups, and lifecycle emails.
									</p>
								</div>
								<Switch bind:checked={emailNotifications} />
							</div>
							<div class="flex items-center justify-between">
								<div>
									<p>Customer texts (SMS)</p>
									<p class="text-xs text-muted-foreground">
										Scheduled, on-the-way, and completed texts (requires Twilio).
									</p>
								</div>
								<Switch bind:checked={smsNotifications} />
							</div>
							<Field.Field>
								<Field.Label for="s-sms-sig">Text signature</Field.Label>
								<Input
									id="s-sms-sig"
									bind:value={smsSignature}
									placeholder="e.g. Acme Plumbing"
									maxlength={60}
								/>
								<p class="text-xs text-muted-foreground">
									Appended to every automated customer text (blank = unsigned).
								</p>
							</Field.Field>
							<div class="flex items-center justify-between">
								<div>
									<p>Staff morning digest</p>
									<p class="text-xs text-muted-foreground">
										Daily "jobs today" email to each technician.
									</p>
								</div>
								<Switch bind:checked={staffDigest} />
							</div>
							<Field.Field>
								<Field.Label for="s-remind">Reminder lead time (hours)</Field.Label>
								<Input id="s-remind" type="number" min={1} max={168} bind:value={reminderHours} />
								<p class="text-xs text-muted-foreground">
									How far ahead customers get the appointment reminder — default 36h.
								</p>
							</Field.Field>
							<div class="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/30 p-3">
								<div class="min-w-40 flex-1">
									<Label for="test-sms-to">Test sends</Label>
									<Input
										id="test-sms-to"
										bind:value={testSmsTo}
										placeholder="+1 555 123 4567"
										class="mt-1"
									/>
								</div>
								<Button variant="outline" size="sm" disabled={testPending} onclick={testEmail}
									>Email me</Button
								>
								<Button
									variant="outline"
									size="sm"
									disabled={testPending || !testSmsTo.trim()}
									onclick={testSms}>Text this number</Button
								>
							</div>
							<p class="text-xs text-muted-foreground">
								Manual Send buttons on invoices and estimates always work.
							</p>
							<div class="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
								<p class="mb-1 font-medium text-foreground">Delivery status (Twilio)</p>
								To track sent/delivered/failed on the SMS log below, set your Twilio number's status-callback
								URL to<b>HTTP GET</b>:
								<button
									type="button"
									class="mt-1 block w-full truncate rounded bg-muted px-2 py-1 text-left font-mono text-[11px] text-foreground hover:bg-muted/80"
									onclick={() =>
										copyText(
											`${page.url.origin}/api/webhooks/twilio-status?org=${page.data.org.id}`,
											'Status callback URL copied'
										)}
								>
									{page.url.origin}/api/webhooks/twilio-status?org={page.data.org.id}
								</button>
							</div>
							<div class="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
								<p class="mb-1 font-medium text-foreground">Inbound SMS (Twilio)</p>
								To receive customer replies (and honor STOP/START), set your Twilio number's "A message
								comes in" webhook to<b>HTTP GET</b>:
								<button
									type="button"
									class="mt-1 block w-full truncate rounded bg-muted px-2 py-1 text-left font-mono text-[11px] text-foreground hover:bg-muted/80"
									onclick={() =>
										copyText(
											`${page.url.origin}/api/webhooks/twilio?org=${page.data.org.id}`,
											'Webhook URL copied'
										)}
								>
									{page.url.origin}/api/webhooks/twilio?org={page.data.org.id}
								</button>
							</div>
							<div>
								<p class="mb-1.5 font-medium">SMS log</p>
								{#if smsLog.length === 0}
									<p class="text-xs text-muted-foreground">
										Queued and sent texts will appear here.
									</p>
								{:else}
									<div class="space-y-1.5">
										{#each smsLog as m (m.id)}
											<div
												class="flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs"
											>
												<div class="min-w-0">
													<p class="truncate">{m.to} — {m.body}</p>
													<p class="text-muted-foreground">
														{formatRelative(m.sendAfter)}{m.statusDetail
															? ` — ${m.statusDetail}`
															: ''}
													</p>
												</div>
												<Badge
													variant={m.status === 'delivered' || m.status === 'sent'
														? 'secondary'
														: m.status === 'failed' || m.status === 'undelivered'
															? 'destructive'
															: 'outline'}>{m.status}</Badge
												>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						</div>
						<div class="space-y-3 rounded-lg border p-3 text-sm">
							<p class="font-medium">Invoicing</p>
							<Field.Field>
								<Field.Label for="terms">Payment terms (days)</Field.Label>
								<Input
									id="terms"
									type="number"
									min="0"
									max="365"
									class="w-24"
									bind:value={invoiceTermsDays}
								/>
								<p class="text-xs text-muted-foreground">
									New invoices are due this many days after they're issued.
								</p>
							</Field.Field>
							<Field.Field>
								<Field.Label for="inv-footer">Invoice footer</Field.Label>
								<Textarea
									id="inv-footer"
									rows={2}
									bind:value={invoiceFooter}
									placeholder="e.g. Payment due on receipt · late fee 1.5%/mo"
								/>
								<p class="text-xs text-muted-foreground">
									Shown at the bottom of the customer invoice page.
								</p>
							</Field.Field>
							<Field.Field>
								<Field.Label for="est-valid">Estimate validity (days)</Field.Label>
								<Input
									id="est-valid"
									type="number"
									min="1"
									max="365"
									class="w-24"
									bind:value={estimateValidDays}
								/>
								<p class="text-xs text-muted-foreground">
									Sent estimates expire this many days later unless you set a different date.
								</p>
							</Field.Field>
							<Field.Field>
								<Field.Label for="est-footer">Estimate footer</Field.Label>
								<Textarea
									id="est-footer"
									rows={2}
									bind:value={estimateFooter}
									placeholder="e.g. Warranty: 1 year on parts & labor · permits not included"
								/>
								<p class="text-xs text-muted-foreground">
									Fine print on the customer estimate page and printed quote.
								</p>
							</Field.Field>
							<Field.Field>
								<Field.Label for="tax-rate">Sales tax (%)</Field.Label>
								<Input
									id="tax-rate"
									type="number"
									min="0"
									max="30"
									step="0.01"
									class="w-24"
									bind:value={taxRatePct}
								/>
								<p class="text-xs text-muted-foreground">
									Appended as a Sales tax line on every new invoice. 0 = untaxed.
								</p>
							</Field.Field>
							<Field.Field>
								<Field.Label for="late-fee">Late fee ($)</Field.Label>
								<Input
									id="late-fee"
									type="number"
									min="0"
									max="1000"
									step="0.01"
									class="w-24"
									bind:value={lateFeeDollars}
								/>
								<p class="text-xs text-muted-foreground">
									Added once to an invoice that runs 3+ days past due. 0 = no late fees.
								</p>
							</Field.Field>
							<Field.Field>
								<Field.Label for="deposit-pct">Estimate deposit (%)</Field.Label>
								<Input
									id="deposit-pct"
									type="number"
									min="0"
									max="100"
									step="1"
									class="w-24"
									bind:value={depositPct}
								/>
								<p class="text-xs text-muted-foreground">
									When a customer approves an estimate, invoice this % up front and email the pay
									link. 0 = no deposit.
								</p>
							</Field.Field>
							<Field.Field>
								<Field.Label for="labor-round">Labor rounding (min)</Field.Label>
								<Input
									id="labor-round"
									type="number"
									min="0"
									max="120"
									step="1"
									class="w-24"
									bind:value={laborRounding}
								/>
								<p class="text-xs text-muted-foreground">
									Round billed time up to this increment on hourly invoices (e.g. 15 rounds
									47&#8202;min up to 60). 0 = bill exact minutes.
								</p>
							</Field.Field>
							<Field.Field>
								<Field.Label for="mat-markup">Materials markup %</Field.Label>
								<Input
									id="mat-markup"
									type="number"
									min="0"
									max="100"
									step="1"
									class="w-24"
									bind:value={materialsMarkup}
								/>
								<p class="text-xs text-muted-foreground">
									Sell price prefilled when logging materials on a job (cost × 1+markup). 0 = bill
									at cost.
								</p>
							</Field.Field>
							<div class="flex items-center justify-between">
								<div>
									<p>Auto-draft invoice on completion</p>
									<p class="text-xs text-muted-foreground">
										When a job with materials is completed, draft its invoice automatically for
										review.
									</p>
								</div>
								<Switch bind:checked={autoInvoiceOnComplete} />
							</div>
							<div class="flex items-center justify-between">
								<div>
									<p>Send service report on completion</p>
									<p class="text-xs text-muted-foreground">
										When a job completes, email/text the customer a link to their visit report —
										work done, checklist, materials and photos.
									</p>
								</div>
								<Switch bind:checked={autoSendReport} />
							</div>
						</div>
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
							<div class="flex items-center justify-between">
								<div>
									<p class="text-sm font-medium">Accept online bookings</p>
									<p class="text-xs text-muted-foreground">
										Off shows visitors a "booking closed" notice instead of the form.
									</p>
								</div>
								<Switch checked={bookingEnabled} onCheckedChange={(v) => (bookingEnabled = v)} />
							</div>
							<Field.Field>
								<Field.Label for="s-notice">Minimum notice (days)</Field.Label>
								<Input
									id="s-notice"
									type="number"
									min={0}
									max={90}
									bind:value={bookingNoticeDays}
								/>
								<p class="text-xs text-muted-foreground">
									How far ahead customers must book — 0 allows same-day requests.
								</p>
							</Field.Field>
							<Field.Field>
								<Field.Label for="s-max-ahead">Book at most (days out)</Field.Label>
								<Input
									id="s-max-ahead"
									type="number"
									min={0}
									max={365}
									bind:value={bookingMaxDaysAhead}
								/>
								<p class="text-xs text-muted-foreground">
									Farthest date customers can request — 0 = no limit.
								</p>
							</Field.Field>
							<Field.Field>
								<Field.Label for="s-daily-limit">Daily booking limit</Field.Label>
								<Input
									id="s-daily-limit"
									type="number"
									min={0}
									max={100}
									bind:value={bookingDailyLimit}
								/>
								<p class="text-xs text-muted-foreground">
									Max bookings accepted per requested day — 0 = unlimited.
								</p>
							</Field.Field>
							<Field.Field>
								<Field.Label for="s-deposit">Booking deposit</Field.Label>
								<MoneyInput id="s-deposit" bind:value={bookingDeposit} />
								<p class="text-xs text-muted-foreground">
									Fixed amount charged right after an online booking when a payment provider is set
									up — 0 = free to book. Applied to the customer's first invoice.
								</p>
							</Field.Field>
							<Field.Field>
								<Field.Label for="s-zips">Service ZIPs</Field.Label>
								<Input id="s-zips" bind:value={serviceZips} placeholder="90210, 90211, 90212" />
								<p class="text-xs text-muted-foreground">
									Comma-separated ZIPs customers can book in — blank accepts anywhere.
								</p>
							</Field.Field>
							<Field.Field>
								<Field.Label for="s-bookmsg">Booking confirmation</Field.Label>
								<Input
									id="s-bookmsg"
									bind:value={bookingMessage}
									placeholder="We'll call or email you to confirm a time."
								/>
								<p class="text-xs text-muted-foreground">
									Shown on the booking page after a request is sent — blank uses the default.
								</p>
							</Field.Field>
							<div class="flex items-center justify-between">
								<div>
									<p class="text-sm font-medium">Review bookings first</p>
									<p class="text-xs text-muted-foreground">
										Online requests sit flagged "needs review" until staff accept or decline them.
									</p>
								</div>
								<Switch checked={bookingReview} onCheckedChange={(v) => (bookingReview = v)} />
							</div>
							<Field.Field>
								<Field.Label for="s-blackouts">Closed dates</Field.Label>
								<Input
									id="s-blackouts"
									bind:value={bookingBlackouts}
									placeholder="2026-12-25, 2026-01-01"
								/>
								<p class="text-xs text-muted-foreground">
									Comma-separated dates (YYYY-MM-DD) the booking page won't accept — holidays,
									closures.
								</p>
							</Field.Field>
						{/if}
						<Button type="submit" disabled={pending}>Save</Button>
					</form>
				</Card.Content>
			</Card.Root>

			<Card.Root class="mt-4 max-w-3xl">
				<Card.Header>
					<Card.Title class="text-base">Preferences</Card.Title>
					<Card.Description>Saved to this browser, not your profile.</Card.Description>
				</Card.Header>
				<Card.Content>
					<div class="flex items-center justify-between rounded-lg border p-3 text-sm">
						<div>
							<p class="font-medium">Appearance</p>
							<p class="text-xs text-muted-foreground">Light, dark, or follow your system.</p>
						</div>
						<div class="flex gap-1">
							{#each [{ id: 'light', icon: Sun, label: 'Light' }, { id: 'dark', icon: Moon, label: 'Dark' }, { id: 'system', icon: MonitorSmartphone, label: 'System' }] as m (m.id)}
								<Button
									size="sm"
									variant={userPrefersMode.current === m.id ? 'default' : 'outline'}
									onclick={() => setMode(m.id as 'light' | 'dark' | 'system')}
									title={m.label}><m.icon /></Button
								>
							{/each}
						</div>
					</div>
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
					<div class="flex items-center justify-between rounded-lg border p-3 text-sm">
						<div>
							<p class="font-medium">Workspace backup</p>
							<p class="text-xs text-muted-foreground">
								All customers, jobs, billing, inventory and settings as one JSON file — owners &amp;
								admins only; secrets are never included.
							</p>
						</div>
						<Button
							size="sm"
							variant="outline"
							onclick={() => (window.location.href = '/api/export/workspace.json')}
							><Download /> Download</Button
						>
					</div>
				</Card.Content>
			</Card.Root>
		</Tabs.Content>

		<Tabs.Content value="offices">
			<Card.Root class="max-w-3xl">
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
							<li class="list-none">
								<Empty.Root class="border-0 py-4">
									<Empty.Header>
										<Empty.Media><Building2 /></Empty.Media>
										<Empty.Title class="text-sm">No offices</Empty.Title>
										<Empty.Description>Add your main branch.</Empty.Description>
									</Empty.Header>
								</Empty.Root>
							</li>
						{/each}
					</ul>
				</Card.Content>
			</Card.Root>
		</Tabs.Content>

		<Tabs.Content value="team">
			<Card.Root class="max-w-3xl">
				<Card.Header>
					<Card.Title class="text-base">Team ({staff.length} members)</Card.Title>
					<Card.Description>Staff become technicians on the dispatch board.</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-4 px-6">
					<ul class="divide-y">
						{#each staff as s (s.id)}
							<li class="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
								<div class="min-w-0">
									<p class="truncate font-medium">
										<a class="underline-offset-2 hover:underline" href="/team/{s.id}">{s.name}</a>
									</p>
									<p class="truncate text-xs text-muted-foreground">{s.email}</p>
								</div>
								<div class="flex flex-wrap items-center justify-end gap-2">
									<label class="flex items-center gap-1 text-xs text-muted-foreground">
										<Input
											type="number"
											min={0}
											max={100}
											class="h-7 w-16"
											value={s.commissionPct}
											onchange={(e) => saveCommission(s, e)}
										/>
										% comm.
									</label>
									<label
										class="flex items-center gap-1 text-xs text-muted-foreground"
										title="Loaded cost per hour — turns logged time into a job margin cost"
									>
										$
										<Input
											type="number"
											min={0}
											max={500}
											step="0.5"
											class="h-7 w-16"
											value={s.laborCostCents / 100}
											onchange={(e) => saveLaborCost(s, e)}
										/>
										/hr cost
									</label>
									<label
										class="flex items-center gap-1 text-xs text-muted-foreground"
										title="Overtime multiplier past 40h in a payroll week (150 = 1.5× the loaded rate)"
									>
										<Input
											type="number"
											min={100}
											max={300}
											step={10}
											class="h-7 w-16"
											value={s.overtimePct}
											onchange={(e) => saveOvertime(s, e)}
										/>
										% OT
									</label>
									<label
										class="flex items-center gap-1 text-xs text-muted-foreground"
										title="Staff notification emails (bookings, decisions, digest)"
									>
										<Switch
											checked={s.staffAlerts}
											onCheckedChange={(v) => saveStaffAlerts(s, v)}
										/>
										alerts
									</label>
									<label
										class="flex items-center gap-1 text-xs text-muted-foreground"
										title="Mobile for hot-alert texts — new bookings, cancel requests, charge disputes, portal messages"
									>
										<Input
											class="h-7 w-28"
											placeholder="SMS #"
											value={s.phone ?? ''}
											onchange={(e) => saveMemberPhone(s, e)}
										/>
										sms
									</label>
									<label
										class="flex items-center gap-1 text-xs text-muted-foreground"
										title="Show on the dispatch board and in tech pickers"
									>
										<Switch
											checked={s.dispatchVisible}
											onCheckedChange={(v) => saveDispatchVisible(s, v)}
										/>
										dispatch
									</label>
									<span
										class="flex items-center gap-1"
										title="Accent color on this member's dispatch column"
									>
										<input
											type="color"
											class="size-6 cursor-pointer rounded border bg-transparent p-0"
											value={s.color || '#e2e8f0'}
											onchange={(e) => saveMemberColor(s, e.currentTarget.value)}
											aria-label="Dispatch color for {s.name}"
										/>
										{#if s.color}
											<Button
												size="sm"
												variant="ghost"
												class="size-6 px-0 text-muted-foreground"
												title="Clear dispatch color"
												onclick={() => saveMemberColor(s, '')}>×</Button
											>
										{/if}
									</span>
									<label
										class="flex items-center gap-1 text-xs text-muted-foreground"
										title="Trade license number + expiry — flagged on the dashboard 30d out"
									>
										<Input
											class="h-7 w-24"
											placeholder="lic. #"
											value={s.licenseNo}
											onchange={(e) => {
												s.licenseNo = e.currentTarget.value;
												saveLicense(s);
											}}
										/>
										<Input
											type="date"
											class="h-7 w-32"
											value={s.licenseExpiry ?? ''}
											onchange={(e) => {
												s.licenseExpiry = e.currentTarget.value;
												saveLicense(s);
											}}
										/>
										{#if s.licenseExpiry && s.licenseExpiry <= thirtyDaysOut}
											<Badge variant={s.licenseExpiry < todayStr ? 'destructive' : 'secondary'}
												>{s.licenseExpiry < todayStr ? 'expired' : 'expiring'}</Badge
											>
										{/if}
									</label>
									<DropdownMenu.Root>
										<DropdownMenu.Trigger
											class="inline-flex h-7 items-center rounded-md border px-2 text-xs hover:bg-accent"
											title="Qualified job types — dispatch flags assignments outside them"
											>skills{skillIds(s).length
												? ` ${skillIds(s).length}`
												: ''}</DropdownMenu.Trigger
										>
										<DropdownMenu.Content align="end" class="max-h-64 w-52 overflow-y-auto">
											<DropdownMenu.Label class="text-xs">Qualified job types</DropdownMenu.Label>
											{#each jobTypes as t (t.id)}
												<DropdownMenu.CheckboxItem
													checked={skillIds(s).includes(t.id)}
													closeOnSelect={false}
													onCheckedChange={() => toggleSkill(s, t.id)}
													>{t.name}</DropdownMenu.CheckboxItem
												>
											{/each}
											<DropdownMenu.Separator />
											<DropdownMenu.Item class="text-xs" onclick={() => setSkills(s, [])}
												>Clear — qualified for all</DropdownMenu.Item
											>
										</DropdownMenu.Content>
									</DropdownMenu.Root>
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

			<Card.Root class="max-w-3xl">
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
								<div class="flex shrink-0 items-center gap-1.5">
									{#if t.timeOff.status === 'pending'}
										<Badge variant="secondary">pending</Badge>
										<Button
											variant="outline"
											size="sm"
											onclick={() => setTimeOff({ id: t.timeOff.id, status: 'approved' })}
											>Approve</Button
										>
										<Button
											variant="ghost"
											size="sm"
											onclick={() => setTimeOff({ id: t.timeOff.id, status: 'denied' })}
											>Deny</Button
										>
									{:else if t.timeOff.status === 'denied'}
										<Badge variant="outline">denied</Badge>
									{/if}
									<Button
										variant="ghost"
										size="icon"
										class="size-7"
										onclick={() => removeTimeOff(t.timeOff.id)}><Trash class="size-4" /></Button
									>
								</div>
							</li>
						{:else}
							<li class="list-none">
								<Empty.Root class="border-0 py-3">
									<Empty.Header>
										<Empty.Media><CalendarX2 /></Empty.Media>
										<Empty.Title class="text-sm">No time off scheduled</Empty.Title>
									</Empty.Header>
								</Empty.Root>
							</li>
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
			<Card.Root class="max-w-3xl">
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
				<Card.Content class="overflow-x-auto px-0">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Name</Table.Head>
								<Table.Head class="hidden md:table-cell">Duration</Table.Head>
								<Table.Head class="hidden md:table-cell">Checklist</Table.Head>
								<Table.Head class="hidden md:table-cell">Default tech</Table.Head>
								<Table.Head class="hidden md:table-cell">Kit</Table.Head>
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
									<Table.Cell
										class="hidden md:table-cell"
										onclick={(e) => {
											e.stopPropagation();
											openKit(t);
										}}
									>
										{#if kitCount[t.id]}
											<Button variant="ghost" size="sm" class="h-6 px-1.5"
												>{kitCount[t.id]} item{kitCount[t.id] === 1 ? '' : 's'}</Button
											>
										{:else}
											<Button variant="ghost" size="sm" class="h-6 px-1.5 text-muted-foreground"
												>Set kit</Button
											>
										{/if}
									</Table.Cell>
									<Table.Cell class="text-right" onclick={(e) => e.stopPropagation()}>
										<Switch checked={t.active} onCheckedChange={(v) => toggleJt(t, v)} />
									</Table.Cell>
								</Table.Row>
							{:else}
								<Table.Row>
									<Table.Cell colspan={6} class="text-center text-muted-foreground">
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
										<Checkbox bind:checked={keyPerms[r]} />
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
										<Table.Cell class="text-xs text-muted-foreground">
											{#if w.lastDeliveryAt}
												<span
													class={w.lastDeliveryStatus && w.lastDeliveryStatus < 400
														? 'text-green-600'
														: 'text-destructive'}>{w.lastDeliveryStatus || 'failed'}</span
												>
											{:else}
												never
											{/if}
										</Table.Cell>
										<Table.Cell class="text-right">
											<Button
												variant="ghost"
												size="icon"
												class="size-7"
												title="Delivery history"
												onclick={() => toggleHookHistory(w.id)}><History class="size-4" /></Button
											>
											<Button
												variant="ghost"
												size="icon"
												class="size-7"
												title="Send a test event"
												disabled={testingHook === w.id}
												onclick={async () => {
													testingHook = w.id;
													try {
														const status = await testWebhook(w.id);
														toast[status > 0 && status < 400 ? 'success' : 'error'](
															status > 0
																? `Test delivered — HTTP ${status}`
																: 'Test failed — endpoint unreachable'
														);
														webhooks = await getWebhooks();
													} catch (err) {
														toast.error(errMsg(err, 'Test failed'));
													}
													testingHook = '';
												}}><Send class="size-4" /></Button
											>
										</Table.Cell>
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
									{#if hookHistory[w.id]}
										<Table.Row class="bg-muted/40 hover:bg-muted/40">
											<Table.Cell colspan={6} class="p-0">
												<ul class="divide-y">
													{#each hookHistory[w.id] as d (d.id)}
														<li class="flex items-center gap-3 px-4 py-1.5 text-xs">
															<span class="min-w-0 flex-1 truncate font-mono">{d.eventType}</span>
															<span
																class={d.status > 0 && d.status < 400
																	? 'text-green-600'
																	: 'text-destructive'}>{d.status || 'failed'}</span
															>
															<span class="text-muted-foreground"
																>{formatRelative(d.createdAt)}</span
															>
															{#if d.canRetry && !(d.status > 0 && d.status < 400)}
																<Button
																	variant="ghost"
																	size="sm"
																	class="h-6 px-2 text-xs"
																	disabled={retryingDelivery === d.id}
																	onclick={() => retryDelivery(w.id, d.id)}>Retry</Button
																>
															{/if}
														</li>
													{:else}
														<li class="px-4 py-2 text-xs text-muted-foreground">
															No deliveries recorded yet.
														</li>
													{/each}
												</ul>
											</Table.Cell>
										</Table.Row>
									{/if}
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
			<Card.Root class="max-w-3xl">
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
								await seedDemo({});
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
					<Field.Label for="jt-amount">Default amount</Field.Label>
					<MoneyInput id="jt-amount" bind:value={jtAmount} />
				</Field.Field>
				<Field.Field>
					<Field.Label for="jt-rate">Billable rate/hr</Field.Label>
					<MoneyInput id="jt-rate" bind:value={jtRate} />
				</Field.Field>
			</div>
			<p class="-mt-2 text-xs text-muted-foreground">
				Rate/hr turns logged time into a Labor line when invoicing; leave both blank to quote per
				job.
			</p>
			<div class="grid grid-cols-2 gap-4">
				<Field.Field>
					<Field.Label for="jt-duration">Duration (min)</Field.Label>
					<Input id="jt-duration" type="number" min={5} required bind:value={jtDuration} />
				</Field.Field>
				<Field.Field>
					<Field.Label for="jt-warranty">Labor warranty (days)</Field.Label>
					<Input id="jt-warranty" type="number" min={0} max={3650} bind:value={jtWarrantyDays} />
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
				<div class="flex items-center justify-between">
					<Field.Label for="jt-checklist">Checklist — one step per line</Field.Label>
					{#if aiStatus.available}
						<Button
							type="button"
							variant="ghost"
							size="sm"
							class="h-7 text-muted-foreground"
							title="Draft steps with AI from the job-type name"
							disabled={jtAiPending || jtName.trim().length < 2}
							onclick={draftJtChecklist}><Sparkles /> {jtAiPending ? 'Drafting…' : 'Draft'}</Button
						>
					{/if}
				</div>
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
				<div>
					<label for="jt-req-checklist" class="text-sm font-medium"
						>Require checklist to complete</label
					>
					<p class="text-xs text-muted-foreground">Job can't be completed with open steps.</p>
				</div>
				<Switch
					id="jt-req-checklist"
					checked={jtReqChecklist}
					onCheckedChange={(v) => (jtReqChecklist = v)}
				/>
			</div>
			<div class="flex items-center justify-between">
				<div>
					<label for="jt-req-photo" class="text-sm font-medium">Require photo to complete</label>
					<p class="text-xs text-muted-foreground">At least one photo before completion.</p>
				</div>
				<Switch id="jt-req-photo" checked={jtReqPhoto} onCheckedChange={(v) => (jtReqPhoto = v)} />
			</div>
			<div class="flex items-center justify-between">
				<div>
					<label for="jt-req-signature" class="text-sm font-medium"
						>Require signature to complete</label
					>
					<p class="text-xs text-muted-foreground">Customer sign-off before completion.</p>
				</div>
				<Switch
					id="jt-req-signature"
					checked={jtReqSignature}
					onCheckedChange={(v) => (jtReqSignature = v)}
				/>
			</div>
			<div class="flex items-center justify-between">
				<div>
					<label for="jt-req-doc" class="text-sm font-medium">Require document to complete</label>
					<p class="text-xs text-muted-foreground">
						At least one attached document (permit, contract) before completion.
					</p>
				</div>
				<Switch id="jt-req-doc" checked={jtReqDoc} onCheckedChange={(v) => (jtReqDoc = v)} />
			</div>
			<div class="flex items-center justify-between">
				<div>
					<label for="jt-req-timer" class="text-sm font-medium">Require clock-in on site</label>
					<p class="text-xs text-muted-foreground">
						Technician can't mark on-site until they have logged time on the job.
					</p>
				</div>
				<Switch id="jt-req-timer" checked={jtReqTimer} onCheckedChange={(v) => (jtReqTimer = v)} />
			</div>
			<div class="flex items-center justify-between">
				<div>
					<label for="jt-req-helper" class="text-sm font-medium">2-person job</label>
					<p class="text-xs text-muted-foreground">
						Scheduling is blocked until a helper (second tech) is assigned.
					</p>
				</div>
				<Switch
					id="jt-req-helper"
					checked={jtReqHelper}
					onCheckedChange={(v) => (jtReqHelper = v)}
				/>
			</div>
			<div class="flex items-center justify-between">
				<div>
					<label for="jt-bookable" class="text-sm font-medium">Bookable online</label>
					<p class="text-xs text-muted-foreground">
						Customers can pick it on the public booking page.
					</p>
				</div>
				<Switch id="jt-bookable" checked={jtBookable} onCheckedChange={(v) => (jtBookable = v)} />
			</div>
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

<!-- material kit editor -->
<Dialog.Root bind:open={kitOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Material kit — {kitType?.name}</Dialog.Title>
			<Dialog.Description
				>Default materials a tech can add to a job of this type in one tap (from warehouse stock).</Dialog.Description
			>
		</Dialog.Header>
		<div class="space-y-2">
			{#each kitRows as row, i (i)}
				<div class="flex items-center gap-2">
					<Select.Root
						type="single"
						value={row.inventoryItemId}
						onValueChange={(v) => (row.inventoryItemId = v)}
					>
						<Select.Trigger class="min-w-0 flex-1"
							>{invRows.find((r) => r.item.id === row.inventoryItemId)?.item.name ??
								'Pick an item…'}</Select.Trigger
						>
						<Select.Content>
							{#each invRows as r (r.item.id)}
								<Select.Item value={r.item.id}
									>{r.item.name}
									<span class="text-muted-foreground">({r.item.qtyOnHand} {r.item.unit})</span
									></Select.Item
								>
							{/each}
						</Select.Content>
					</Select.Root>
					<Input
						type="number"
						min={1}
						class="w-20 shrink-0"
						aria-label="Quantity"
						bind:value={row.qty}
					/>
					<Button
						variant="ghost"
						size="icon"
						class="size-8 shrink-0 text-muted-foreground"
						onclick={() => kitRows.splice(i, 1)}><Trash class="size-4" /></Button
					>
				</div>
			{/each}
			<Button
				size="sm"
				variant="outline"
				onclick={() => kitRows.push({ inventoryItemId: '', qty: 1 })}
				><Plus class="size-4" /> Add item</Button
			>
		</div>
		<Dialog.Footer>
			<Button onclick={saveKit} disabled={kitPending}>{kitPending ? 'Saving…' : 'Save kit'}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
