<script lang="ts">
	import Receipt from '@lucide/svelte/icons/receipt';
	import FileText from '@lucide/svelte/icons/file-text';
	import Printer from '@lucide/svelte/icons/printer';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import EllipsisVertical from '@lucide/svelte/icons/ellipsis-vertical';
	import CalendarPlus from '@lucide/svelte/icons/calendar-plus';
	import CreditCard from '@lucide/svelte/icons/credit-card';
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
		getMergePreview,
		mergeCustomers,
		textCustomerCmd,
		emailStatementCmd,
		getEquipmentJobs,
		removeSavedCard,
		chargeCardOnFile,
		revokePortalAccess,
		addContact,
		updateContact,
		removeContact,
		removeCustomerDoc,
		shareCustomerDoc,
		setDocExpiry
	} from '#lib/remote/customers.remote.ts';
	import {
		addFollowUp,
		completeFollowUp,
		removeFollowUp,
		snoozeFollowUp
	} from '#lib/remote/followups.remote.ts';
	import {
		recordPayment,
		addCredit,
		invoiceUninvoicedJobs,
		getInvoices
	} from '#lib/remote/billing.remote.ts';
	import {
		getSchedules,
		createSchedule,
		updateSchedule,
		deleteSchedule
	} from '#lib/remote/maintenance.remote.ts';
	import { getJobTypes, getTechnicians, scheduleAgreementVisits } from '#lib/remote/jobs.remote.ts';
	import { errMsg, formatDate, formatMoney, formatRelative } from '#lib/format.ts';
	import { localDate, localTime } from '#lib/tz.ts';
	import { getSettings, getStaff } from '#lib/remote/workspace.remote.ts';
	import Plus from '@lucide/svelte/icons/plus';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import AirVent from '@lucide/svelte/icons/air-vent';
	import Link2 from '@lucide/svelte/icons/link-2';
	import Wrench from '@lucide/svelte/icons/wrench';
	import Download from '@lucide/svelte/icons/download';
	import GitMerge from '@lucide/svelte/icons/git-merge';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import BellPlus from '@lucide/svelte/icons/bell-plus';
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
	let doNotService = $state(c.customer.doNotService);
	let taxExempt = $state(c.customer.taxExempt);
	let taxRatePct = $state(c.customer.taxRateBps != null ? c.customer.taxRateBps / 100 : '');
	let leadSource = $state(c.customer.leadSource);
	let preferredMemberId = $state(c.customer.preferredMemberId ?? '');
	let termsDays = $state<number | ''>(c.customer.termsDays ?? '');
	let contactPref = $state<'' | 'email' | 'sms'>(
		(c.customer.contactPref ?? '') as '' | 'email' | 'sms'
	);
	const technicians = $derived(await getTechnicians());
	const staff = $derived(await getStaff());
	const pendingVisits = $derived(
		c.jobs.filter((j) => j.job.serviceAgreementId && j.job.status === 'unscheduled')
	);
	let visitsOpen = $state(false);
	let visitsPending = $state(false);
	let visitRows = $state<{ jobId: string; startsAt: string; technicianId: string }[]>([]);
	function openVisits() {
		visitRows = pendingVisits.map((j) => ({
			jobId: j.job.id,
			startsAt: `${j.job.agreementPeriod ?? ''}T09:00`,
			technicianId: j.job.technicianId ?? ''
		}));
		visitsOpen = true;
	}
	async function saveVisits() {
		visitsPending = true;
		try {
			const r = await scheduleAgreementVisits({
				customerId: id,
				visits: visitRows.map((v) => ({
					jobId: v.jobId,
					startsAt: v.startsAt,
					technicianId: v.technicianId || null
				}))
			});
			await getCustomer(id).refresh();
			if (r.failed.length)
				toast.error(
					`Scheduled ${r.scheduled.length}; ${r.failed.length} failed — ${r.failed[0].message}`
				);
			else
				toast.success(
					`Scheduled ${r.scheduled.length} visit${r.scheduled.length === 1 ? '' : 's'}`
				);
			if (!r.failed.length) visitsOpen = false;
		} catch (err) {
			toast.error(errMsg(err, 'Could not schedule visits'));
		}
		visitsPending = false;
	}
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
			doNotService = c.customer.doNotService;
			taxExempt = c.customer.taxExempt;
			taxRatePct = c.customer.taxRateBps != null ? c.customer.taxRateBps / 100 : '';
			leadSource = c.customer.leadSource;
			preferredMemberId = c.customer.preferredMemberId ?? '';
			termsDays = c.customer.termsDays ?? '';
			contactPref = (c.customer.contactPref ?? '') as '' | 'email' | 'sms';
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
				doNotService,
				taxExempt,
				taxRateBps:
					taxRatePct === '' || taxRatePct == null ? null : Math.round(Number(taxRatePct) * 100),
				leadSource,
				preferredMemberId: preferredMemberId || null,
				termsDays: termsDays === '' || termsDays == null ? null : Number(termsDays),
				contactPref: contactPref || null
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

	// ------- contacts -------
	let contactOpen = $state(false);
	let contactPending = $state(false);
	let contactId = $state<string | null>(null);
	let contactName = $state('');
	let contactRole = $state('');
	let contactEmail = $state('');
	let contactPhone = $state('');
	let contactPrimary = $state(false);

	function openContact(ct?: (typeof c.contacts)[number]) {
		contactId = ct?.id ?? null;
		contactName = ct?.name ?? '';
		contactRole = ct?.role ?? '';
		contactEmail = ct?.email ?? '';
		contactPhone = ct?.phone ?? '';
		contactPrimary = ct?.isPrimary ?? false;
		contactOpen = true;
	}

	async function saveContact(e: SubmitEvent) {
		e.preventDefault();
		contactPending = true;
		try {
			const input = {
				name: contactName,
				role: contactRole,
				email: contactEmail,
				phone: contactPhone,
				isPrimary: contactPrimary
			};
			if (contactId) {
				await updateContact({ id: contactId, customerId: id, ...input }).updates(getCustomer);
			} else {
				await addContact({ customerId: id, ...input }).updates(getCustomer);
			}
			toast.success('Contact saved');
			contactOpen = false;
		} catch (err) {
			toast.error(errMsg(err, 'Could not save contact'));
		}
		contactPending = false;
	}

	// ------- follow-ups -------
	let fupOpen = $state(false);
	let fupPending = $state(false);
	let fupNote = $state('');
	let fupDue = $state('');
	let fupMember = $state('');

	const todayIso = $derived(localDate(new Date(), tz));

	function openFollowUp() {
		fupNote = '';
		fupDue = todayIso;
		fupMember = '';
		fupOpen = true;
	}

	async function saveFollowUp(e: SubmitEvent) {
		e.preventDefault();
		fupPending = true;
		try {
			await addFollowUp({
				note: fupNote.trim(),
				dueOn: fupDue,
				customerId: id,
				memberId: fupMember || null
			}).updates(getCustomer);
			toast.success('Follow-up added');
			fupOpen = false;
		} catch (err) {
			toast.error(errMsg(err, 'Could not add follow-up'));
		}
		fupPending = false;
	}

	let docUploading = $state(false);
	async function uploadDoc(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		docUploading = true;
		try {
			const form = new FormData();
			form.set('file', file);
			const res = await fetch(`/api/customers/${id}/documents`, { method: 'POST', body: form });
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				throw new Error(body?.message ?? `Upload failed (${res.status})`);
			}
			await getCustomer(id).refresh();
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
			await setDocExpiry({ id: expDocId, customerId: id, expiresOn: expDate || null });
			expOpen = false;
			toast.success(expDate ? 'Expiry set' : 'Expiry cleared');
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

	async function deleteContact(ct: (typeof c.contacts)[number]) {
		try {
			await removeContact({ id: ct.id, customerId: id }).updates(getCustomer);
			toast.success('Contact removed');
		} catch (err) {
			toast.error(errMsg(err, 'Could not remove contact'));
		}
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
	let eqPhotoPath = $state('');
	let eqPhotoBusy = $state(false);

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
		eqPhotoPath = e?.equipment.photoPath ?? '';
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

	async function uploadEqPhoto(ev: Event) {
		const input = ev.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file || !eqId) return;
		eqPhotoBusy = true;
		try {
			const fd = new FormData();
			fd.set('file', file);
			const res = await fetch(`/api/equipment/${eqId}/photo`, { method: 'POST', body: fd });
			if (!res.ok)
				throw new Error(((await res.json().catch(() => ({}))) as { message?: string }).message);
			await getCustomer(id).refresh();
			eqPhotoPath =
				(await getCustomer(id)).equipment.find((x) => x.equipment.id === eqId)?.equipment
					.photoPath ?? '';
			toast.success('Photo saved');
		} catch (err) {
			toast.error(errMsg(err, 'Could not upload photo'));
		}
		eqPhotoBusy = false;
		input.value = '';
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
	let cardPending = $state(false);
	async function removeCard() {
		cardPending = true;
		try {
			await removeSavedCard(id).updates(getCustomer);
			toast.success('Card on file removed');
		} catch (err) {
			toast.error(errMsg(err, 'Could not remove the card'));
		}
		cardPending = false;
	}
	let chargingCard = $state(false);
	async function chargeCard() {
		chargingCard = true;
		try {
			const r = await chargeCardOnFile(id).updates(getCustomer);
			if (r.failed)
				toast.error(
					`${formatMoney(r.charged, currency)} charged — ${formatMoney(r.failed, currency)} declined`
				);
			else toast.success(`Charged ${formatMoney(r.charged, currency)} to the card on file`);
		} catch (err) {
			toast.error(errMsg(err, 'Could not charge the card'));
		}
		chargingCard = false;
	}
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

	let invoicingAll = $state(false);
	async function invoiceAllDone() {
		invoicingAll = true;
		try {
			const dueDate = new Date(
				Date.now() + (c.customer.termsDays ?? settings.invoiceTermsDays) * 86400_000
			)
				.toISOString()
				.slice(0, 10);
			const res = await invoiceUninvoicedJobs({ customerId: id, dueDate }).updates(getInvoices);
			if (res.created === 0) {
				toast.info(
					res.skipped
						? `${res.skipped} done job${res.skipped === 1 ? '' : 's'} had no billable lines — skipped`
						: 'Nothing to invoice'
				);
			} else {
				toast.success(
					`Drafted ${res.created} invoice${res.created === 1 ? '' : 's'} (${res.numbers
						.map((n) => `J-${n}`)
						.join(', ')})` +
						(res.skipped
							? ` · ${res.skipped} job${res.skipped === 1 ? '' : 's'} had nothing billable`
							: '')
				);
				goto(`/billing?customer=${id}`);
			}
		} catch (err) {
			toast.error(errMsg(err, 'Could not create invoices'));
		}
		invoicingAll = false;
	}

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
		{#if c.customer.doNotService}
			<Badge variant="destructive">do not service</Badge>
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
		<Button
			size="sm"
			variant="outline"
			href="/customers/{id}/history"
			target="_blank"
			title="Printable service history"><Printer /></Button
		>
		<Button
			size="sm"
			variant="outline"
			href="/customers/{id}/statement"
			target="_blank"
			title="Printable statement of open charges">Statement</Button
		>
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
				{#if c.customer.savedCardLabel}
					<div
						class="mb-3 flex items-center justify-between gap-2 rounded-md border border-dashed p-2 text-xs"
					>
						<span class="flex items-center gap-1.5 text-muted-foreground"
							><CreditCard class="size-3.5" />
							{c.customer.savedCardLabel} on file — recurring charges auto-collect</span
						>
						<span class="flex gap-1">
							<Button
								variant="ghost"
								size="sm"
								class="h-6 px-2 text-xs"
								disabled={chargingCard ||
									!c.charges.some(
										(ch) => ch.charge.status === 'open' && ch.charge.amount - ch.paid > 0
									)}
								onclick={chargeCard}>Charge now</Button
							>
							<Button
								variant="ghost"
								size="sm"
								class="h-6 px-2 text-xs"
								disabled={cardPending}
								onclick={removeCard}>Remove</Button
							>
						</span>
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
							<Switch bind:checked={doNotService} /> Do not service — block all new work
						</label>
						<label class="flex items-center gap-2 text-sm">
							<Switch bind:checked={taxExempt} /> Tax exempt — no sales tax on invoices
						</label>
						<label class="flex items-center gap-2 text-sm">
							Invoice terms
							<Input
								type="number"
								min={0}
								max={3650}
								class="w-24"
								bind:value={termsDays}
								placeholder="org default"
								aria-label="Invoice terms (days)"
							/>
							<span class="text-xs text-muted-foreground">days — blank uses workspace default</span>
						</label>
						<label class="flex items-center gap-2 text-sm">
							Preferred contact
							<Select.Root type="single" bind:value={contactPref}>
								<Select.Trigger class="w-40"
									>{contactPref === 'email'
										? 'Email'
										: contactPref === 'sms'
											? 'Text message'
											: 'No preference'}
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="">No preference</Select.Item>
									<Select.Item value="email">Email</Select.Item>
									<Select.Item value="sms">Text message</Select.Item>
								</Select.Content>
							</Select.Root>
							<span class="text-xs text-muted-foreground">scheduling notifications only</span>
						</label>
						<label class="flex items-center gap-2 text-sm">
							Tax rate
							<Input
								type="number"
								min={0}
								max={300}
								step={0.01}
								class="w-24"
								disabled={taxExempt}
								bind:value={taxRatePct}
								placeholder="org default"
								aria-label="Sales tax rate %"
							/>
							<span class="text-xs text-muted-foreground">% — blank uses the workspace default</span
							>
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
					>Contacts{#if c.contacts.length}
						<span class="ml-1 text-xs font-normal text-muted-foreground">({c.contacts.length})</span
						>{/if}</Card.Title
				>
				<Button size="sm" variant="outline" onclick={() => openContact()}><Plus /> Add</Button>
			</Card.Header>
			<Card.Content class="space-y-2 px-4">
				{#each c.contacts as ct (ct.id)}
					<div class="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm">
						<button class="min-w-0 flex-1 text-left" onclick={() => openContact(ct)}>
							<span class="flex items-center gap-2 font-medium"
								>{ct.name}
								{#if ct.isPrimary}<StatusBadge status="active" label="primary" />{/if}</span
							>
							<span class="mt-1 block truncate text-xs text-muted-foreground">
								{[ct.role, ct.email, ct.phone].filter(Boolean).join(' · ') || 'No details'}
							</span>
						</button>
						<DropdownMenu.Root>
							<DropdownMenu.Trigger
								class="inline-flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-accent"
							>
								<EllipsisVertical class="size-4" />
							</DropdownMenu.Trigger>
							<DropdownMenu.Content align="end">
								<DropdownMenu.Item onclick={() => openContact(ct)}>Edit</DropdownMenu.Item>
								{#if !ct.isPrimary}
									<DropdownMenu.Item
										onclick={() =>
											updateContact({
												id: ct.id,
												customerId: id,
												isPrimary: true
											}).updates(getCustomer)}>Set as primary</DropdownMenu.Item
									>
								{/if}
								<DropdownMenu.Item class="text-destructive" onclick={() => deleteContact(ct)}
									>Remove</DropdownMenu.Item
								>
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					</div>
				{:else}
					<Empty.Root class="border-0 py-2">
						<Empty.Header>
							<Empty.Media><UserPlus /></Empty.Media>
							<Empty.Title class="text-sm">No contacts</Empty.Title>
							<Empty.Description class="text-xs"
								>Track site leads, tenants and AP contacts.</Empty.Description
							>
						</Empty.Header>
					</Empty.Root>
				{/each}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header class="flex-row items-center justify-between">
				<Card.Title class="text-base"
					>Follow-ups{#if c.followUps.filter((f) => !f.doneAt).length}
						<span class="ml-1 text-xs font-normal text-muted-foreground"
							>({c.followUps.filter((f) => !f.doneAt).length} open)</span
						>{/if}</Card.Title
				>
				<Button size="sm" variant="outline" onclick={openFollowUp}><Plus /> Add</Button>
			</Card.Header>
			<Card.Content class="space-y-2 px-4">
				{#each c.followUps as f (f.id)}
					<div
						class="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm {f.doneAt
							? 'opacity-50'
							: ''}"
					>
						<div class="min-w-0 flex-1">
							<span class="flex items-center gap-2 font-medium"
								>{f.note}
								{#if f.jobNumber}
									<a href="/jobs/{f.jobId}" class="shrink-0"
										><Badge variant="outline" class="font-normal">J-{f.jobNumber}</Badge></a
									>
								{/if}</span
							>
							<span class="mt-1 flex items-center gap-2 text-xs">
								{#if f.doneAt}
									<span class="text-muted-foreground">done {formatDate(f.doneAt)}</span>
								{:else}
									<span
										class={f.dueOn < todayIso
											? 'font-medium text-red-600 dark:text-red-400'
											: f.dueOn === todayIso
												? 'font-medium text-amber-600 dark:text-amber-400'
												: 'text-muted-foreground'}
										>due {f.dueOn}{f.dueOn < todayIso ? ' — overdue' : ''}</span
									>
								{/if}
								<span class="text-muted-foreground">· {f.assignee}</span>
							</span>
						</div>
						<DropdownMenu.Root>
							<DropdownMenu.Trigger
								class="inline-flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-accent"
							>
								<EllipsisVertical class="size-4" />
							</DropdownMenu.Trigger>
							<DropdownMenu.Content align="end">
								{#if !f.doneAt}
									<DropdownMenu.Item onclick={() => completeFollowUp(f.id).updates(getCustomer)}
										>Mark done</DropdownMenu.Item
									>
									<DropdownMenu.Item
										onclick={() => snoozeFollowUp({ id: f.id, days: 1 }).updates(getCustomer)}
										>Snooze 1 day</DropdownMenu.Item
									>
									<DropdownMenu.Item
										onclick={() => snoozeFollowUp({ id: f.id, days: 7 }).updates(getCustomer)}
										>Snooze 1 week</DropdownMenu.Item
									>
								{/if}
								<DropdownMenu.Item
									class="text-destructive"
									onclick={() => removeFollowUp(f.id).updates(getCustomer)}
									>Remove</DropdownMenu.Item
								>
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					</div>
				{:else}
					<Empty.Root class="border-0 py-2">
						<Empty.Header>
							<Empty.Media><BellPlus /></Empty.Media>
							<Empty.Title class="text-sm">No follow-ups</Empty.Title>
							<Empty.Description class="text-xs"
								>Remind yourself or a teammate to check back.</Empty.Description
							>
						</Empty.Header>
					</Empty.Root>
				{/each}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header class="flex-row items-center justify-between">
				<Card.Title class="text-base"
					>Documents{#if c.documents.length}
						<span class="ml-1 text-xs font-normal text-muted-foreground"
							>({c.documents.length})</span
						>{/if}</Card.Title
				>
				<label
					class="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition-colors hover:bg-accent {docUploading
						? 'pointer-events-none opacity-60'
						: ''}"
				>
					<Paperclip class="size-4" />
					{docUploading ? 'Uploading…' : 'Upload'}
					<input type="file" class="sr-only" disabled={docUploading} onchange={uploadDoc} />
				</label>
			</Card.Header>
			<Card.Content class="space-y-2 px-4">
				{#each c.documents as d (d.id)}
					<div class="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm">
						<div class="flex min-w-0 flex-1 items-center gap-2">
							<FileText class="size-4 shrink-0 text-muted-foreground" />
							<div class="min-w-0">
								<a
									href="/files/customer-document/{d.id}"
									target="_blank"
									class="block truncate font-medium hover:underline">{d.fileName}</a
								>
								<span class="flex items-center gap-1 text-xs text-muted-foreground"
									>{docSize(d.size)} · {formatDate(d.createdAt)}{d.uploadedBy
										? ` · ${d.uploadedBy}`
										: ''}{#if d.shared}
										<Badge variant="secondary">portal</Badge>{/if}{#if d.viaPortal}
										<Badge variant="outline">from customer</Badge>{/if}{#if d.expiresOn}
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
								<DropdownMenu.Item
									onclick={() =>
										shareCustomerDoc({
											id: d.id,
											customerId: id,
											shared: !d.shared
										}).updates(getCustomer)}
									>{d.shared ? 'Unshare from portal' : 'Share to portal'}</DropdownMenu.Item
								>
								<DropdownMenu.Item onclick={() => openDocExpiry(d)}>Set expiry…</DropdownMenu.Item>
								{#if d.expiresOn}
									<DropdownMenu.Item
										onclick={() =>
											setDocExpiry({
												id: d.id,
												customerId: id,
												expiresOn: null
											}).updates(getCustomer)}>Clear expiry</DropdownMenu.Item
									>
								{/if}
								<DropdownMenu.Item
									class="text-destructive"
									onclick={() =>
										removeCustomerDoc({ id: d.id, customerId: id }).updates(getCustomer)}
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
								>Contracts, permits and paperwork for this account.</Empty.Description
							>
						</Empty.Header>
					</Empty.Root>
				{/each}
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
						{#if l.laborWarrantyUntil}
							<p class="mt-1 text-xs text-amber-600 dark:text-amber-400">
								labor warranty through {formatDate(l.laborWarrantyUntil)}
							</p>
						{/if}
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
							<span class="flex min-w-0 items-center gap-2 font-medium">
								{#if e.equipment.photoPath}
									<img
										src="/files/equipment-photo/{e.equipment.id}"
										alt=""
										class="size-8 shrink-0 rounded object-cover"
									/>
								{/if}
								<span class="truncate">{e.equipment.name}</span>
							</span>
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
					<div class="flex gap-2">
						{#if pendingVisits.length}
							<Button size="sm" variant="outline" onclick={openVisits}
								><CalendarPlus class="size-4" /> Schedule visits ({pendingVisits.length})</Button
							>
						{/if}
						<Button size="sm" variant="outline" href="/agreements?new=1&customer={id}"
							><Plus /> New</Button
						>
					</div>
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
						<Empty.Root class="border-0 py-3">
							<Empty.Header>
								<Empty.Media><FileText /></Empty.Media>
								<Empty.Title class="text-sm">No service agreements</Empty.Title>
							</Empty.Header>
						</Empty.Root>
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
					{#if c.uninvoicedJobs > 0}
						<Button
							size="sm"
							variant="outline"
							onclick={invoiceAllDone}
							disabled={invoicingAll}
							title="Draft an invoice for each completed job that isn't invoiced yet"
							>Invoice {c.uninvoicedJobs} done job{c.uninvoicedJobs === 1 ? '' : 's'}</Button
						>
					{/if}
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
							.map( (ch) => ({ key: `ch-${ch.charge.id}`, d: new Date(`${ch.charge.dueDate}T00:00:00Z`), label: ch.charge.description || 'Charge', status: ch.charge.status, cents: ch.charge.amount - ch.paid, disputed: !!ch.charge.disputedAt }) ), ...c.payments.map( (p) => ({ key: `p-${p.id}`, d: p.paidAt, label: `Payment — ${p.method}`, status: 'paid', cents: -p.amount, disputed: false }) )]
						.sort((a, b) => b.d.getTime() - a.d.getTime())
						.slice(0, 10) as row (row.key)}
						<li class="flex items-center justify-between">
							<span class="truncate"
								>{row.label}
								{#if row.disputed}<span
										class="ml-1 text-xs font-medium text-amber-600 dark:text-amber-400"
										>disputed</span
									>{/if}
								<span class="text-xs text-muted-foreground">{formatDate(row.d)}</span></span
							>
							<span class="tabular-nums {row.cents < 0 ? 'text-emerald-600' : ''}"
								>{row.cents < 0 ? '−' : ''}{formatMoney(Math.abs(row.cents), currency)}</span
							>
						</li>
					{:else}
						<li class="list-none">
							<Empty.Root class="border-0 py-3">
								<Empty.Header>
									<Empty.Media><Receipt /></Empty.Media>
									<Empty.Title class="text-sm">No billing activity</Empty.Title>
								</Empty.Header>
							</Empty.Root>
						</li>
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

<Dialog.Root bind:open={fupOpen}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>New follow-up</Dialog.Title>
			<Dialog.Description
				>A dated reminder — it shows here, on the dashboard when due, and in the assignee's inbox.</Dialog.Description
			>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={saveFollowUp}>
			<Field.Field>
				<Field.Label for="fup-note">Note</Field.Label>
				<Input id="fup-note" bind:value={fupNote} placeholder="Call about the quote…" required />
			</Field.Field>
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<Field.Field>
					<Field.Label for="fup-due">Due</Field.Label>
					<Input id="fup-due" type="date" bind:value={fupDue} required />
				</Field.Field>
				<Field.Field>
					<Field.Label for="fup-member">Assign to</Field.Label>
					<Select.Root type="single" bind:value={fupMember}>
						<Select.Trigger id="fup-member" class="w-full"
							>{staff.find((m) => m.id === fupMember)?.name ?? 'Me'}</Select.Trigger
						>
						<Select.Content>
							<Select.Item value="">Me</Select.Item>
							{#each staff as m (m.id)}
								<Select.Item value={m.id}>{m.name}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</Field.Field>
			</div>
			<Dialog.Footer>
				<Button type="submit" disabled={fupPending || !fupNote.trim() || !fupDue}
					>{fupPending ? 'Saving…' : 'Add follow-up'}</Button
				>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={contactOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{contactId ? 'Edit contact' : 'New contact'}</Dialog.Title>
			<Dialog.Description>A person at this account — office manager, tenant, AP.</Dialog.Description
			>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={saveContact}>
			<Field.Field>
				<Field.Label for="ct-name">Name</Field.Label>
				<Input id="ct-name" bind:value={contactName} required />
			</Field.Field>
			<Field.Field>
				<Field.Label for="ct-role">Role</Field.Label>
				<Input id="ct-role" bind:value={contactRole} placeholder="Office manager, tenant…" />
			</Field.Field>
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<Field.Field>
					<Field.Label for="ct-email">Email</Field.Label>
					<Input id="ct-email" type="email" bind:value={contactEmail} />
				</Field.Field>
				<Field.Field>
					<Field.Label for="ct-phone">Phone</Field.Label>
					<Input id="ct-phone" bind:value={contactPhone} />
				</Field.Field>
			</div>
			<label class="flex items-center gap-2 text-sm">
				<Switch bind:checked={contactPrimary} /> Primary contact
			</label>
			<Dialog.Footer>
				<Button type="submit" disabled={contactPending || !contactName.trim()}
					>{contactPending ? 'Saving…' : 'Save contact'}</Button
				>
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
					<p class="pb-1.5 text-sm font-medium">Photo</p>
					<div class="flex items-center gap-3">
						{#if eqPhotoPath}
							<img
								src="/files/equipment-photo/{eqId}"
								alt=""
								class="size-16 rounded-md border object-cover"
							/>
						{/if}
						<label
							class="inline-flex cursor-pointer items-center rounded-md border px-3 py-1.5 text-sm hover:bg-accent {eqPhotoBusy
								? 'pointer-events-none opacity-50'
								: ''}"
						>
							{eqPhotoBusy ? 'Uploading…' : eqPhotoPath ? 'Replace photo' : 'Upload photo'}
							<input
								type="file"
								accept="image/jpeg,image/png,image/webp,image/gif,image/heic"
								class="sr-only"
								onchange={uploadEqPhoto}
							/>
						</label>
					</div>
				</div>
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
								<Empty.Root class="border-0 py-3">
									<Empty.Header>
										<Empty.Media><Wrench /></Empty.Media>
										<Empty.Title class="text-sm">No jobs on this unit yet</Empty.Title>
									</Empty.Header>
								</Empty.Root>
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
		{#if mergeSource}
			{@const preview = await getMergePreview(mergeSource)}
			{#if preview}
				<p class="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
					Moves {preview.jobs} jobs · {preview.estimates} estimates · {preview.invoices}
					invoices · {preview.charges} charges · {preview.equipment} equipment ·
					{preview.locations} locations · {preview.agreements} agreements — then deletes the duplicate.
				</p>
			{/if}
		{/if}
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

<!-- schedule agreement visits -->
<Dialog.Root bind:open={visitsOpen}>
	<Dialog.Content class="max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Schedule agreement visits</Dialog.Title>
			<Dialog.Description>
				{pendingVisits.length} unscheduled visit{pendingVisits.length === 1 ? '' : 's'} from service agreements
				— set a start (and optionally a technician) for each.
			</Dialog.Description>
		</Dialog.Header>
		<div class="max-h-96 space-y-2 overflow-y-auto">
			{#each visitRows as v, i (v.jobId)}
				{@const j = pendingVisits[i]}
				<div class="space-y-1.5 rounded-lg border p-3 text-sm">
					<p class="font-medium">
						J-{j.job.number}
						<span class="font-normal text-muted-foreground">
							· {j.jobTypeName ?? j.job.summary}{j.job.agreementPeriod
								? ` · ${j.job.agreementPeriod}`
								: ''}</span
						>
					</p>
					<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
						<Input
							type="datetime-local"
							value={v.startsAt}
							onchange={(e) => (v.startsAt = e.currentTarget.value)}
						/>
						<Select.Root type="single" bind:value={visitRows[i].technicianId}>
							<Select.Trigger class="w-full"
								>{technicians.find((t) => t.id === visitRows[i].technicianId)?.name ??
									'Unassigned'}</Select.Trigger
							>
							<Select.Content>
								<Select.Item value="">Unassigned</Select.Item>
								{#each technicians as t (t.id)}
									<Select.Item value={t.id}>{t.name}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
				</div>
			{/each}
		</div>
		<Dialog.Footer>
			<Button disabled={visitsPending || visitRows.some((v) => !v.startsAt)} onclick={saveVisits}>
				{visitsPending ? 'Scheduling…' : `Schedule ${visitRows.length}`}
			</Button>
		</Dialog.Footer>
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

<Dialog.Root bind:open={expOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Document expiry</Dialog.Title>
			<Dialog.Description>
				Warranty, permit or insurance expiry — surfaces on the dashboard when it's within 30 days.
			</Dialog.Description>
		</Dialog.Header>
		<form
			class="space-y-4"
			onsubmit={(e) => {
				e.preventDefault();
				saveDocExpiry();
			}}
		>
			<Field.Field>
				<Field.Label for="doc-exp">Expires on</Field.Label>
				<Input id="doc-exp" type="date" bind:value={expDate} />
			</Field.Field>
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (expOpen = false)}>Cancel</Button>
				<Button type="submit">Save</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
