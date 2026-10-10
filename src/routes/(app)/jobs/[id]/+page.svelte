<script lang="ts">
	import Clock from '@lucide/svelte/icons/clock';
	import Receipt from '@lucide/svelte/icons/receipt';
	import Image from '@lucide/svelte/icons/image';
	import History from '@lucide/svelte/icons/history';
	import BellPlus from '@lucide/svelte/icons/bell-plus';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import Globe from '@lucide/svelte/icons/globe';
	import EllipsisVertical from '@lucide/svelte/icons/ellipsis-vertical';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import { Progress } from '#lib/components/ui/progress/index.js';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import PageHeader from '#lib/components/app/page-header.svelte';
	import MoneyInput from '#lib/components/app/money-input.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import { toast } from 'svelte-sonner';
	import {
		getJob,
		getJobs,
		getDispatchBoard,
		updateJob,
		recordJobEvent,
		getJobTypes,
		getTechnicians,
		getTimeEntries,
		startTimer,
		stopTimer,
		addTimeEntry,
		updateTimeEntry,
		deleteTimeEntry,
		createJob,
		repeatJob,
		duplicateJob,
		markNoShow,
		signJob,
		sendJobEta,
		sendServiceReport,
		reviewBooking,
		approveTimeEntry,
		approveAllTimeEntries
	} from '#lib/remote/jobs.remote.ts';
	import { getSettings, getOffices, getStaff } from '#lib/remote/workspace.remote.ts';
	import { getCustomer } from '#lib/remote/customers.remote.ts';
	import { addFollowUp, completeFollowUp, removeFollowUp } from '#lib/remote/followups.remote.ts';
	import {
		getInventory,
		getJobMaterials,
		addJobMaterial,
		applyMaterialKit,
		getJobTypeKits,
		removeJobMaterial,
		getTruckStock,
		createPoFromJob
	} from '#lib/remote/inventory.remote.ts';
	import {
		getJobChecklist,
		addChecklistItem,
		toggleChecklistItem,
		deleteChecklistItem,
		getJobPhotos,
		deleteJobPhoto,
		setJobPhotoShared,
		getJobDocuments,
		removeJobDoc,
		setJobDocShared,
		getJobExpenses,
		addJobExpense,
		removeJobExpense
	} from '#lib/remote/jobs.remote.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { errMsg, formatDate, formatMoney, formatRelative } from '#lib/format.ts';
	import { localDate, localTime } from '#lib/tz.ts';
	import Truck from '@lucide/svelte/icons/truck';
	import Navigation from '@lucide/svelte/icons/navigation';
	import Navigation2 from '@lucide/svelte/icons/navigation-2';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import Phone from '@lucide/svelte/icons/phone';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import FileText from '@lucide/svelte/icons/file-text';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import FilePen from '@lucide/svelte/icons/file-pen';
	import Ban from '@lucide/svelte/icons/ban';
	import UserX from '@lucide/svelte/icons/user-x';
	import Timer from '@lucide/svelte/icons/timer';
	import Package from '@lucide/svelte/icons/package';
	import ReceiptText from '@lucide/svelte/icons/receipt-text';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import Camera from '@lucide/svelte/icons/camera';
	import Eye from '@lucide/svelte/icons/eye';
	import Repeat from '@lucide/svelte/icons/repeat';
	import Copy from '@lucide/svelte/icons/copy';
	import Play from '@lucide/svelte/icons/play';
	import Square from '@lucide/svelte/icons/square';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Printer from '@lucide/svelte/icons/printer';
	import Plus from '@lucide/svelte/icons/plus';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import SignatureDialog from '#lib/components/app/signature-dialog.svelte';

	const id = $derived(page.params.id!);
	const j = $derived(await getJob(id));
	const jobTypes = $derived(await getJobTypes());
	const technicians = $derived(await getTechnicians());
	const matTechName = $derived(
		technicians.find((t) => t.id === j.job.technicianId)?.name ?? 'Tech'
	);
	const offices = $derived(await getOffices());
	const settings = $derived(await getSettings());
	const staff = $derived(await getStaff());
	const c = $derived(await getCustomer(j.job.customerId));
	const tz = $derived(settings.timezone);

	const locked = $derived(j.job.status === 'done' || j.job.status === 'cancelled');

	// ------- edit fields -------
	let jobTypeId = $state(j.job.jobTypeId ?? '');
	let technicianId = $state(j.job.technicianId ?? '');
	let helperId = $state(j.job.helperId ?? '');
	let officeId = $state(j.job.officeId ?? '');
	let serviceLocationId = $state(j.job.serviceLocationId ?? '');
	let equipmentId = $state(j.job.equipmentId ?? '');
	const unitHistory = $derived(
		equipmentId
			? (await getJobs({ equipmentId }))
					.filter((x) => x.job.id !== id && x.job.status === 'done')
					.slice(0, 5)
			: []
	);
	let summary = $state(j.job.summary);
	let description = $state(j.job.description);
	let jobTags = $state((j.job.tags ?? []).join(', '));
	let priority = $state(j.job.priority);
	let dependsOnJobId = $state(j.job.dependsOnJobId ?? '');
	let arrivalWindow = $state(j.job.arrivalWindow ?? '');
	let startsAt = $state(
		j.job.startsAt
			? `${localDate(j.job.startsAt, settings.timezone)}T${localTime(j.job.startsAt, settings.timezone)}`
			: ''
	);
	let durationMin = $state(
		j.job.startsAt && j.job.endsAt
			? Math.round((j.job.endsAt.getTime() - j.job.startsAt.getTime()) / 60000)
			: 60
	);
	let endsAt = $state(
		j.job.endsAt
			? `${localDate(j.job.endsAt, settings.timezone)}T${localTime(j.job.endsAt, settings.timezone)}`
			: ''
	);
	let loadedId = '';
	$effect(() => {
		if (j.job.id !== loadedId) {
			loadedId = j.job.id;
			jobTypeId = j.job.jobTypeId ?? '';
			technicianId = j.job.technicianId ?? '';
			helperId = j.job.helperId ?? '';
			officeId = j.job.officeId ?? '';
			serviceLocationId = j.job.serviceLocationId ?? '';
			equipmentId = j.job.equipmentId ?? '';
			summary = j.job.summary;
			description = j.job.description;
			jobTags = (j.job.tags ?? []).join(', ');
			priority = j.job.priority;
			dependsOnJobId = j.job.dependsOnJobId ?? '';
			arrivalWindow = j.job.arrivalWindow ?? '';
			startsAt = j.job.startsAt
				? `${localDate(j.job.startsAt, settings.timezone)}T${localTime(j.job.startsAt, settings.timezone)}`
				: '';
			durationMin =
				j.job.startsAt && j.job.endsAt
					? Math.round((j.job.endsAt.getTime() - j.job.startsAt.getTime()) / 60000)
					: 60;
			endsAt = j.job.endsAt
				? `${localDate(j.job.endsAt, settings.timezone)}T${localTime(j.job.endsAt, settings.timezone)}`
				: '';
		}
	});
	let pending = $state(false);

	async function save(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			await updateJob({
				id,
				jobTypeId: jobTypeId || null,
				technicianId: technicianId || null,
				helperId: helperId || null,
				officeId: officeId || null,
				serviceLocationId: serviceLocationId || null,
				equipmentId: equipmentId || null,
				summary,
				description,
				priority,
				tags: jobTags
					.split(',')
					.map((t) => t.trim())
					.filter(Boolean),
				dependsOnJobId: dependsOnJobId || null,
				arrivalWindow: arrivalWindow || null,
				startsAt: startsAt || null,
				durationMin,
				...(endsAt ? { endsAt } : {})
			}).updates(getJob, getJobs, getDispatchBoard);
			toast.success('Job saved');
		} catch (err) {
			toast.error(errMsg(err, 'Could not save'));
		}
		pending = false;
	}

	let cancelOpen = $state(false);
	let etaOpen = $state(false);
	let etaPending = $state(false);
	let reportSending = $state(false);
	async function sendReport() {
		reportSending = true;
		try {
			await sendServiceReport(id).updates(getJob);
			toast.success('Service report sent to the customer');
		} catch (err) {
			toast.error(errMsg(err, 'Could not send report'));
		}
		reportSending = false;
	}

	async function sendEta(minutes: number) {
		etaPending = true;
		try {
			await sendJobEta({ jobId: id, minutes });
			toast.success('ETA text sent');
			etaOpen = false;
		} catch (err) {
			toast.error(errMsg(err, 'Could not send ETA text'));
		}
		etaPending = false;
	}
	let cancelReason = $state('');
	let cancelling = $state(false);

	async function cancel(e: SubmitEvent) {
		e.preventDefault();
		cancelling = true;
		try {
			await updateJob({ id, cancelled: true, cancelReason: cancelReason.trim() }).updates(
				getJob,
				getJobs,
				getDispatchBoard
			);
			cancelOpen = false;
			toast.success('Job cancelled');
		} catch (err) {
			toast.error(errMsg(err, 'Could not cancel'));
		}
		cancelling = false;
	}

	async function event(kind: 'dispatched' | 'en_route' | 'on_site' | 'completed', note?: string) {
		try {
			await recordJobEvent({ jobId: id, kind, note: note || null }).updates(
				getJob,
				getJobs,
				getDispatchBoard
			);
			toast.success(kind === 'completed' ? 'Job done' : `Marked ${kind.replace('_', ' ')}`);
		} catch (err) {
			toast.error(errMsg(err, 'Could not update'));
		}
	}

	// ------- signature -------
	let signOpen = $state(false);
	let signThenComplete = $state(false);
	let signPending = $state(false);
	let completionNote = $state('');
	async function saveSignature(name: string, dataUrl: string) {
		signPending = true;
		try {
			await signJob({ jobId: id, name, signature: dataUrl }).updates(getJob);
			signOpen = false;
			toast.success('Signature saved');
			if (signThenComplete) await event('completed', completionNote);
		} catch (err) {
			toast.error(errMsg(err, 'Could not save signature'));
		}
		signPending = false;
		signThenComplete = false;
	}
	function openSign(complete: boolean) {
		signThenComplete = complete;
		if (complete) completionNote = '';
		signOpen = true;
	}

	// ------- checklist -------
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
				customerId: j.job.customerId,
				jobId: id,
				memberId: fupMember || null
			}).updates(getJob);
			toast.success('Follow-up added');
			fupOpen = false;
		} catch (err) {
			toast.error(errMsg(err, 'Could not add follow-up'));
		}
		fupPending = false;
	}

	const checklist = $derived(await getJobChecklist(id));
	const checkDone = $derived(checklist.filter((i) => i.done).length);
	let newCheck = $state('');
	async function addCheck(e: SubmitEvent) {
		e.preventDefault();
		const label = newCheck.trim();
		if (!label) return;
		try {
			await addChecklistItem({ jobId: id, label }).updates(getJobChecklist);
			newCheck = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not add item'));
		}
	}
	async function toggleCheck(item: (typeof checklist)[number]) {
		try {
			await toggleChecklistItem({ id: item.id, done: !item.done }).updates(getJobChecklist);
		} catch (err) {
			toast.error(errMsg(err, 'Could not update item'));
		}
	}
	async function delCheck(itemId: string) {
		try {
			await deleteChecklistItem(itemId).updates(getJobChecklist);
		} catch (err) {
			toast.error(errMsg(err, 'Could not remove item'));
		}
	}

	// ------- time tracking -------
	const time = $derived(await getTimeEntries(id));
	const minutes = (e: { startedAt: Date; endedAt: Date | null }) =>
		Math.max(0, Math.round(((e.endedAt ?? new Date()).getTime() - e.startedAt.getTime()) / 60000));
	const fmtDur = (min: number) => {
		min = Math.round(min);
		return min >= 60
			? `${Math.floor(min / 60)}h ${min % 60 ? `${min % 60}m` : ''}`.trim()
			: `${min}m`;
	};
	const totalMin = $derived(time.entries.reduce((s, e) => s + minutes(e.entry), 0));
	const unapprovedCount = $derived(
		time.entries.filter((e) => e.entry.endedAt && !e.entry.approvedAt).length
	);

	let approvingAll = $state(false);
	async function approveAll() {
		approvingAll = true;
		try {
			const r = await approveAllTimeEntries(id).updates(getTimeEntries);
			toast.success(`${r.approved} entr${r.approved === 1 ? 'y' : 'ies'} approved`);
		} catch (err) {
			toast.error(errMsg(err, 'Could not approve entries'));
		}
		approvingAll = false;
	}

	async function toggleTimer() {
		try {
			if (time.mine) await stopTimer(id).updates(getTimeEntries, getJob);
			else await startTimer(id).updates(getTimeEntries, getJob);
		} catch (err) {
			toast.error(errMsg(err, 'Could not update timer'));
		}
	}

	let addingTime = $state(false);
	let editTimeId = $state<string | null>(null);
	let teMember = $state('');
	let teStart = $state('');
	let teEnd = $state('');
	let teNote = $state('');
	let teBreak = $state(0);
	function startEditTime(e: {
		entry: {
			id: string;
			startedAt: Date;
			endedAt: Date | null;
			note: string;
			breakMin: number;
		};
	}) {
		editTimeId = e.entry.id;
		teStart = `${localDate(e.entry.startedAt, tz)}T${localTime(e.entry.startedAt, tz)}`;
		teEnd = e.entry.endedAt
			? `${localDate(e.entry.endedAt, tz)}T${localTime(e.entry.endedAt, tz)}`
			: '';
		teNote = e.entry.note;
		teBreak = e.entry.breakMin;
		addingTime = true;
	}
	function resetTimeForm() {
		addingTime = false;
		editTimeId = null;
		teStart = teEnd = teNote = '';
		teBreak = 0;
		teMember = '';
	}
	async function logTime(e: SubmitEvent) {
		e.preventDefault();
		try {
			if (editTimeId) {
				await updateTimeEntry({
					id: editTimeId,
					jobId: id,
					startedAt: teStart,
					endedAt: teEnd || null,
					note: teNote,
					breakMin: teBreak
				}).updates(getTimeEntries, getJob);
			} else {
				await addTimeEntry({
					jobId: id,
					memberId: teMember || null,
					startedAt: teStart,
					endedAt: teEnd || null,
					note: teNote,
					breakMin: teBreak
				}).updates(getTimeEntries, getJob);
			}
			const wasEdit = !!editTimeId;
			resetTimeForm();
			toast.success(wasEdit ? 'Entry updated' : 'Time logged');
		} catch (err) {
			toast.error(errMsg(err, 'Could not save time'));
		}
	}
	async function removeTime(entryId: string) {
		try {
			await deleteTimeEntry({ id: entryId, jobId: id }).updates(getTimeEntries, getJob);
		} catch (err) {
			toast.error(errMsg(err, 'Could not delete'));
		}
	}

	// ------- materials -------
	const materials = $derived(await getJobMaterials({ jobId: id }));
	const kits = $derived(await getJobTypeKits());
	const jobKit = $derived(kits.filter((k) => k.jobTypeId === j.job.jobTypeId));

	// ------- photos -------
	let lightbox = $state<(typeof photos)[number] | null>(null);
	let photoPhase = $state<'before' | 'during' | 'after'>('during');
	const PHASE_ORDER: Record<string, number> = { before: 0, during: 1, after: 2 };
	const photos = $derived(
		(await getJobPhotos(id))
			.slice()
			.sort(
				(a, b) =>
					(PHASE_ORDER[a.phase ?? 'during'] ?? 1) - (PHASE_ORDER[b.phase ?? 'during'] ?? 1) ||
					a.createdAt.getTime() - b.createdAt.getTime()
			)
	);
	let uploading = $state(false);
	async function uploadPhoto(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		uploading = true;
		try {
			const form = new FormData();
			form.set('file', file);
			form.set('phase', photoPhase);
			const res = await fetch(`/api/jobs/${id}/photos`, { method: 'POST', body: form });
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				throw new Error(body?.message ?? `Upload failed (${res.status})`);
			}
			await getJobPhotos(id).refresh();
			toast.success('Photo added');
		} catch (err) {
			toast.error(errMsg(err, 'Could not upload photo'));
		}
		input.value = '';
		uploading = false;
	}
	async function toggleShare(p: { id: string; shared: boolean }) {
		try {
			await setJobPhotoShared({ id: p.id, shared: !p.shared });
			await getJobPhotos(id).refresh();
			toast.success(p.shared ? 'Hidden from customer portal' : 'Shared on customer portal');
		} catch (err) {
			toast.error(errMsg(err, 'Could not update photo'));
		}
	}

	async function removePhoto(photoId: string) {
		try {
			await deleteJobPhoto(photoId).updates(getJobPhotos);
		} catch (err) {
			toast.error(errMsg(err, 'Could not delete'));
		}
	}

	// ------- documents -------
	const jobDocs = $derived(await getJobDocuments(id));
	let docUploading = $state(false);
	const docSize = (bytes: number) =>
		bytes >= 1_048_576
			? `${(bytes / 1_048_576).toFixed(1)} MB`
			: `${Math.max(1, Math.round(bytes / 1024))} KB`;
	async function uploadDoc(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		docUploading = true;
		try {
			const form = new FormData();
			form.set('file', file);
			const res = await fetch(`/api/jobs/${id}/documents`, { method: 'POST', body: form });
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				throw new Error(body?.message ?? `Upload failed (${res.status})`);
			}
			await getJobDocuments(id).refresh();
			toast.success('Document added');
		} catch (err) {
			toast.error(errMsg(err, 'Could not upload document'));
		}
		input.value = '';
		docUploading = false;
	}
	async function removeDoc(docId: string) {
		try {
			await removeJobDoc(docId).updates(getJobDocuments);
		} catch (err) {
			toast.error(errMsg(err, 'Could not delete'));
		}
	}
	async function toggleDocShare(doc: { id: string; shared: boolean }) {
		try {
			await setJobDocShared({ id: doc.id, shared: !doc.shared });
			await getJobDocuments(id).refresh();
			toast.success(doc.shared ? 'Hidden from customer portal' : 'Shared on customer portal');
		} catch (err) {
			toast.error(errMsg(err, 'Could not update document'));
		}
	}

	const stock = $derived(await getInventory());
	const truckRows = $derived(await getTruckStock());
	let addingMat = $state(false);
	let matItem = $state('');
	let matQty = $state(1);
	let matPrice = $state<number | null>(null);
	let matCustom = $state('');
	let matSource = $state<'warehouse' | 'truck'>('warehouse');
	const truckQty = $derived(
		j.job.technicianId && matItem
			? (truckRows.find(
					(r) => r.stock.memberId === j.job.technicianId && r.stock.inventoryItemId === matItem
				)?.stock.qty ?? 0)
			: 0
	);
	function pickMat(v: string) {
		matItem = v;
		matCustom = '';
		const cost = stock.find((s) => s.item.id === v)?.item.unitCost ?? 0;
		matPrice =
			v === '__custom' ? null : Math.round(cost * (1 + settings.materialsMarkupBps / 10_000));
		matSource = 'warehouse';
	}
	async function logMaterial(e: SubmitEvent) {
		e.preventDefault();
		if (!matItem) return;
		const custom = matItem === '__custom';
		if (custom && !matCustom.trim()) return;
		try {
			await addJobMaterial({
				jobId: id,
				inventoryItemId: custom ? null : matItem,
				customName: custom ? matCustom.trim() : '',
				qty: matQty,
				unitPrice: matPrice ?? 0,
				truckMemberId: !custom && matSource === 'truck' ? j.job.technicianId : null
			}).updates(getJobMaterials, getJob);
			addingMat = false;
			matItem = '';
			matQty = 1;
			matPrice = null;
			matCustom = '';
			toast.success('Material logged');
		} catch (err) {
			toast.error(errMsg(err, 'Could not log material'));
		}
	}
	let applyingKit = $state(false);
	async function applyKit() {
		applyingKit = true;
		try {
			const res = await applyMaterialKit(id).updates(getJobMaterials, getJob);
			if (res.skipped.length)
				toast.warning(
					`Added ${res.applied} kit item${res.applied === 1 ? '' : 's'} — low stock skipped: ${res.skipped.join(', ')}`
				);
			else toast.success(`Added ${res.applied} kit item${res.applied === 1 ? '' : 's'}`);
		} catch (err) {
			toast.error(errMsg(err, 'Could not apply kit'));
		}
		applyingKit = false;
	}

	async function removeMat(materialId: string) {
		try {
			await removeJobMaterial(materialId).updates(getJobMaterials, getJob);
		} catch (err) {
			toast.error(errMsg(err, 'Could not remove material'));
		}
	}
	let ordering = $state(false);
	async function orderParts() {
		ordering = true;
		try {
			const po = await createPoFromJob(id);
			toast.success(`PO-${po.number} drafted from this job's materials`, {
				action: { label: 'View', onClick: () => goto('/inventory') }
			});
		} catch (err) {
			toast.error(errMsg(err, 'Could not create PO'));
		}
		ordering = false;
	}

	// ------- expenses -------
	const expenses = $derived(await getJobExpenses({ jobId: id }));
	let addingExp = $state(false);
	let expDesc = $state('');
	let expVendor = $state('');
	let expAmount = $state<number | null>(null);
	let expOn = $state('');
	async function logExpense(e: SubmitEvent) {
		e.preventDefault();
		if (!expDesc.trim()) return;
		try {
			await addJobExpense({
				jobId: id,
				description: expDesc.trim(),
				vendor: expVendor.trim(),
				amount: expAmount ?? 0,
				incurredOn: expOn || null
			}).updates(getJobExpenses, getJob);
			addingExp = false;
			expDesc = '';
			expVendor = '';
			expAmount = null;
			expOn = '';
			toast.success('Expense logged');
		} catch (err) {
			toast.error(errMsg(err, 'Could not log expense'));
		}
	}
	async function removeExp(expenseId: string) {
		try {
			await removeJobExpense(expenseId).updates(getJobExpenses, getJob);
		} catch (err) {
			toast.error(errMsg(err, 'Could not remove expense'));
		}
	}

	let rebooking = $state(false);
	let repeatOpen = $state(false);
	let repeatWeeks = $state(4);
	let repeatCount = $state(4);
	let repeating = $state(false);
	async function repeat(e: SubmitEvent) {
		e.preventDefault();
		repeating = true;
		try {
			await repeatJob({ jobId: id, everyWeeks: repeatWeeks, count: repeatCount }).updates(
				getJobs,
				getDispatchBoard
			);
			repeatOpen = false;
			toast.success(
				`Booked ${repeatCount} visit${repeatCount > 1 ? 's' : ''} every ${repeatWeeks}w`
			);
		} catch (err) {
			toast.error(errMsg(err, 'Could not repeat'));
		}
		repeating = false;
	}
	async function rebook() {
		rebooking = true;
		try {
			const n = await createJob({
				customerId: j.job.customerId,
				jobTypeId: j.job.jobTypeId ?? null,
				serviceLocationId: j.job.serviceLocationId ?? null,
				equipmentId: j.job.equipmentId ?? null,
				summary: j.job.summary,
				description: j.job.description,
				priority: j.job.priority,
				startsAt: null
			}).updates(getJobs);
			toast.success(`Job J-${n!.number} booked`);
			await goto(`/jobs/${n!.id}`);
		} catch (err) {
			toast.error(errMsg(err, 'Could not rebook'));
		}
		rebooking = false;
	}

	let noShowing = $state(false);
	async function noShow() {
		noShowing = true;
		try {
			const n = await markNoShow(id).updates(getJob);
			toast.success(`Marked no-show — rebooked as J-${n!.number} (unscheduled)`);
			await goto(`/jobs/${n!.id}`);
		} catch (err) {
			toast.error(errMsg(err, 'Could not mark no-show'));
		}
		noShowing = false;
	}

	let duplicating = $state(false);
	async function dupe() {
		duplicating = true;
		try {
			const n = await duplicateJob(id);
			toast.success(`Copied to J-${n!.number} (unscheduled)`);
			await goto(`/jobs/${n!.id}`);
		} catch (err) {
			toast.error(errMsg(err, 'Could not copy job'));
		}
		duplicating = false;
	}

	let reviewing = $state(false);
	async function review(approve: boolean) {
		reviewing = true;
		try {
			await reviewBooking({ jobId: id, approve }).updates(getJob, getJobs, getDispatchBoard);
			toast[approve ? 'success' : 'info'](approve ? 'Booking accepted' : 'Booking declined');
		} catch (err) {
			toast.error(errMsg(err, 'Review failed'));
		}
		reviewing = false;
	}

	let note = $state('');
	async function addNote(e: SubmitEvent) {
		e.preventDefault();
		if (!note.trim()) return;
		try {
			await recordJobEvent({ jobId: id, kind: 'note', note }).updates(getJob);
			note = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not add note'));
		}
	}
</script>

<PageHeader
	title="J-{j.job.number} {j.job.summary || j.jobTypeName}"
	crumbs={[{ label: 'Jobs', href: '/jobs' }]}
>
	{#snippet actions()}
		<StatusBadge status={j.job.status} />
		{#if j.job.warrantyUntil && new Date(j.job.warrantyUntil) > new Date()}
			<Badge variant="outline" class="text-amber-600 dark:text-amber-400"
				>labor warranty through {formatDate(j.job.warrantyUntil)}</Badge
			>
		{/if}
		{#if j.job.source && j.job.source !== 'manual'}
			<Badge variant="secondary" class="capitalize">via {j.job.source}</Badge>
		{/if}
		{#if j.depOpen}
			<a href="/jobs/{j.job.dependsOnJobId}"
				><Badge variant="outline" class="text-amber-600 dark:text-amber-400"
					>blocked by J-{j.depNumber}</Badge
				></a
			>
		{/if}
		{#each j.depJobs as d (d.id)}
			<a href="/jobs/{d.id}"
				><Badge variant="outline" class="text-blue-600 dark:text-blue-400"
					>blocks J-{d.number}</Badge
				></a
			>
		{/each}
		{#if j.job.rating}
			<Badge variant="secondary" title={j.job.ratingNote ?? ''}>★ {j.job.rating}/5</Badge>
		{/if}
		{#if j.sameDay}
			<Badge variant="outline" class="hidden text-amber-600 sm:inline-flex dark:text-amber-400"
				>{j.sameDay} other visit{j.sameDay === 1 ? '' : 's'} today</Badge
			>
		{/if}
		{#if j.techDay}
			<Badge variant="outline" class="hidden text-muted-foreground sm:inline-flex"
				>{j.techDay + 1} on {matTechName}'s day</Badge
			>
		{/if}
		{#each j.locJobs as l (l.id)}
			<a href="/jobs/{l.id}" class="hidden lg:inline"
				><Badge variant="outline" class="text-muted-foreground" title="Also at this location"
					>also here: J-{l.number}</Badge
				></a
			>
		{/each}
		{#if j.job.status === 'scheduled'}
			<Button size="sm" variant="outline" onclick={() => event('dispatched')}
				><Truck /> Dispatch</Button
			>
		{:else if j.job.status === 'dispatched'}
			<Button size="sm" variant="outline" onclick={() => event('en_route')}
				><Navigation /> En route</Button
			>
			<Button size="sm" variant="outline" onclick={() => event('on_site')}
				><MapPin /> On site</Button
			>
		{:else if j.job.status === 'in_progress'}
			<Button size="sm" onclick={() => openSign(true)}><CircleCheck /> Complete</Button>
		{/if}
		{#if j.job.status === 'done' || j.job.status === 'unscheduled' || j.job.status === 'scheduled'}
			<Button size="sm" variant="outline" onclick={() => (repeatOpen = true)}
				><Repeat /> Repeat…</Button
			>
		{/if}
		{#if j.job.status === 'done'}
			<Button size="sm" variant="outline" disabled={rebooking} onclick={rebook}>Book again</Button>
			<Button
				size="sm"
				variant="ghost"
				class="hidden md:inline-flex"
				title="Send service report — emails/texts the customer their visit summary"
				disabled={reportSending}
				onclick={sendReport}><ClipboardCheck /></Button
			>
		{/if}
		{#if j.job.status === 'done' && j.openBalance === 0}
			<Button size="sm" href="/billing?invoiceFor={id}"><FileText /> Invoice</Button>
		{/if}
		{#if j.job.status !== 'cancelled'}
			<Button size="sm" variant="outline" class="hidden md:inline-flex" href="/estimates?job={id}"
				><FilePen /> Quote</Button
			>
		{/if}
		<Button
			class="hidden md:inline-flex"
			size="sm"
			variant="ghost"
			title="Copy job — same details, new unscheduled job"
			disabled={duplicating}
			onclick={dupe}><Copy /></Button
		>
		<Button
			class="hidden md:inline-flex"
			size="sm"
			variant="ghost"
			href="/jobs/{id}/workorder"
			target="_blank"
			title="Print work order"><Printer /></Button
		>
		{#if j.address1}
			<Button
				class="hidden md:inline-flex"
				size="sm"
				variant="ghost"
				href="https://www.google.com/maps/search/{encodeURIComponent(
					`${j.address1}, ${j.city ?? ''} ${j.state ?? ''} ${j.zip ?? ''}`
				)}"
				target="_blank"
				title="Directions"><Navigation2 /></Button
			>
		{/if}
		{#if j.customerPhone}
			<Button
				class="hidden md:inline-flex"
				size="sm"
				variant="ghost"
				title="Text the customer an ETA"
				onclick={() => (etaOpen = true)}><MessageSquare /></Button
			>
		{/if}
		{#if !locked}
			<Button
				size="sm"
				variant="ghost"
				class="hidden text-amber-600 md:inline-flex dark:text-amber-500"
				title="Customer no-show — cancel and rebook as unscheduled"
				disabled={noShowing}
				onclick={noShow}><UserX /></Button
			>
			<Button
				size="sm"
				variant="ghost"
				class="hidden text-destructive md:inline-flex"
				title="Cancel job"
				onclick={() => (cancelOpen = true)}><Ban /></Button
			>
		{/if}
		<DropdownMenu.Root>
			<DropdownMenu.Trigger
				class="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent md:hidden"
			>
				<EllipsisVertical class="size-4" />
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end">
				<DropdownMenu.Item disabled={duplicating} onclick={dupe}
					><Copy /> Copy job</DropdownMenu.Item
				>
				<DropdownMenu.Item onclick={() => window.open(`/jobs/${id}/workorder`, '_blank')}
					><Printer /> Print work order</DropdownMenu.Item
				>
				{#if j.address1}
					<DropdownMenu.Item
						onclick={() =>
							window.open(
								`https://www.google.com/maps/search/${encodeURIComponent(
									`${j.address1}, ${j.city ?? ''} ${j.state ?? ''} ${j.zip ?? ''}`
								)}`,
								'_blank'
							)}><Navigation2 /> Directions</DropdownMenu.Item
					>
				{/if}
				{#if j.job.status === 'done'}
					<DropdownMenu.Item disabled={reportSending} onclick={sendReport}
						><ClipboardCheck /> Send service report</DropdownMenu.Item
					>
				{/if}
				{#if j.customerPhone}
					<DropdownMenu.Item onclick={() => (etaOpen = true)}
						><MessageSquare /> Text customer ETA</DropdownMenu.Item
					>
				{/if}
				{#if !locked}
					<DropdownMenu.Separator />
					<DropdownMenu.Item disabled={noShowing} onclick={noShow}
						><UserX /> Customer no-show</DropdownMenu.Item
					>
					<DropdownMenu.Item variant="destructive" onclick={() => (cancelOpen = true)}
						><Ban /> Cancel job</DropdownMenu.Item
					>
				{/if}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	{/snippet}
</PageHeader>

{#if j.job.needsReview}
	<div class="px-4 pt-4 md:px-6 md:pt-6">
		<Alert.Root
			class="border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/40 dark:bg-amber-950/30"
		>
			<Globe />
			<Alert.Title>Online booking — needs review</Alert.Title>
			<Alert.Description class="flex flex-wrap items-center gap-x-4 gap-y-2">
				<span
					>This came in through the booking page{j.job.preferredTime
						? ` — asked for ${j.job.preferredTime}`
						: ''}. Accept it into the queue or decline it.</span
				>
				<span class="flex gap-2">
					<Button size="sm" disabled={reviewing} onclick={() => review(true)}>Accept</Button>
					<Button
						size="sm"
						variant="outline"
						class="text-destructive"
						disabled={reviewing}
						onclick={() => review(false)}>Decline</Button
					>
				</span>
			</Alert.Description>
		</Alert.Root>
	</div>
{/if}

<div class="grid grid-cols-1 gap-6 p-4 md:p-6 lg:grid-cols-3">
	<!-- details + edit form -->
	<div class="space-y-6 lg:col-span-2">
		<Card.Root>
			<Card.Header><Card.Title class="text-base">Details</Card.Title></Card.Header>
			<Card.Content>
				<form class="grid grid-cols-1 gap-4 sm:grid-cols-2" onsubmit={save}>
					<Field.Field>
						<Field.Label>Customer</Field.Label>
						<p class="pt-2 text-sm">
							<a href="/customers/{j.job.customerId}" class="font-medium hover:underline"
								>{j.customerName}</a
							>
							{#if j.companyName}<span class="text-muted-foreground"> · {j.companyName}</span>{/if}
							{#if j.customerPhone}
								<a
									href="tel:{j.customerPhone}"
									class="ml-1 inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
									title="Call {j.customerPhone}"><Phone class="size-3" /> {j.customerPhone}</a
								>
							{/if}
						</p>
					</Field.Field>
					<Field.Field>
						<Field.Label>Location</Field.Label>
						<Select.Root type="single" bind:value={serviceLocationId}>
							<Select.Trigger class="w-full"
								>{c.locations.find((l) => l.id === serviceLocationId)
									? `${c.locations.find((l) => l.id === serviceLocationId)!.address1} ${c.locations.find((l) => l.id === serviceLocationId)!.city}`
									: j.address1
										? `${j.address1} ${j.city}`
										: 'On file'}</Select.Trigger
							>
							<Select.Content>
								{#each c.locations as l (l.id)}
									<Select.Item value={l.id}
										>{l.label ? `${l.label} — ` : ''}{l.address1}, {l.city}</Select.Item
									>
								{/each}
							</Select.Content>
						</Select.Root>
						{@const notes =
							c.locations.find((l) => l.id === serviceLocationId)?.accessNotes ?? j.accessNotes}
						{#if notes}
							<p class="pt-1.5 text-xs font-medium text-amber-600 dark:text-amber-500">
								Access: {notes}
							</p>
						{/if}
					</Field.Field>
					<Field.Field>
						<Field.Label>Equipment</Field.Label>
						<Select.Root type="single" bind:value={equipmentId}>
							<Select.Trigger class="w-full"
								>{c.equipment.find((e) => e.equipment.id === equipmentId)?.equipment.name ??
									'None'}</Select.Trigger
							>
							<Select.Content>
								{#each c.equipment.filter((e) => e.equipment.active || e.equipment.id === equipmentId) as e (e.equipment.id)}
									<Select.Item value={e.equipment.id}>
										{e.equipment.name}{[e.equipment.brand, e.equipment.model].filter(Boolean).length
											? ` (${[e.equipment.brand, e.equipment.model].filter(Boolean).join(' ')})`
											: ''}
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
						{#if equipmentId}
							{@const unit = c.equipment.find((e) => e.equipment.id === equipmentId)?.equipment}
							{#if unit}
								<p class="pt-1 text-xs text-muted-foreground">
									<a href="/customers/{j.job.customerId}" class="hover:underline"
										>{[unit.brand, unit.model].filter(Boolean).join(' ') || 'Unit'}</a
									>
									{#if unit.serial}· s/n {unit.serial}{/if}
								</p>
							{/if}
							{#if unitHistory.length}
								<p class="pt-1 text-xs text-muted-foreground">
									Last visits:
									{#each unitHistory as h, i (h.job.id)}<!--
										-->{#if i > 0},
										{/if}<a href="/jobs/{h.job.id}" class="hover:underline">J-{h.job.number}</a
										><!--
									-->{/each}
								</p>
							{/if}
						{/if}
					</Field.Field>
					<Field.Field>
						<Field.Label>Job type</Field.Label>
						<Select.Root type="single" bind:value={jobTypeId}>
							<Select.Trigger class="w-full"
								>{jobTypes.find((t) => t.id === jobTypeId)?.name ?? 'None'}</Select.Trigger
							>
							<Select.Content>
								{#each jobTypes.filter((t) => t.active) as t (t.id)}
									<Select.Item value={t.id}>{t.name}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</Field.Field>
					<Field.Field>
						<Field.Label>Depends on</Field.Label>
						<Select.Root type="single" bind:value={dependsOnJobId}>
							<Select.Trigger class="w-full"
								>{(() => {
									const d = j.depOptions.find((x) => x.id === dependsOnJobId);
									return d ? `J-${d.number} ${d.summary || ''}` : 'None';
								})()}</Select.Trigger
							>
							<Select.Content>
								<Select.Item value="">None</Select.Item>
								{#each j.depOptions as d (d.id)}
									<Select.Item value={d.id}>J-{d.number} {d.summary || ''}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
						<Field.Description
							>Can't be dispatched or completed until that job is done.</Field.Description
						>
					</Field.Field>
					<Field.Field>
						<Field.Label>Technician</Field.Label>
						<Select.Root type="single" bind:value={technicianId}>
							<Select.Trigger class="w-full"
								>{technicians.find((t) => t.id === technicianId)?.name ??
									'Unassigned'}</Select.Trigger
							>
							<Select.Content>
								{#each technicians as t (t.id)}
									<Select.Item value={t.id}>{t.name}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</Field.Field>
					<Field.Field>
						<Field.Label>Helper</Field.Label>
						<Select.Root type="single" bind:value={helperId}>
							<Select.Trigger class="w-full"
								>{technicians.find((t) => t.id === helperId)?.name ?? 'None'}</Select.Trigger
							>
							<Select.Content>
								<Select.Item value="">None</Select.Item>
								{#each technicians.filter((t) => t.id !== technicianId) as t (t.id)}
									<Select.Item value={t.id}>{t.name}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
						<Field.Description>Second tech — sees it on My Day.</Field.Description>
					</Field.Field>
					<Field.Field>
						<Field.Label>Office</Field.Label>
						<Select.Root type="single" bind:value={officeId}>
							<Select.Trigger class="w-full"
								>{offices.find((o) => o.id === officeId)?.name ?? 'None'}</Select.Trigger
							>
							<Select.Content>
								{#each offices.filter((o) => !o.archivedAt) as o (o.id)}
									<Select.Item value={o.id}>{o.name}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</Field.Field>
					<Field.Field>
						<Field.Label>Priority</Field.Label>
						<Select.Root type="single" bind:value={priority}>
							<Select.Trigger class="w-full">{priority}</Select.Trigger>
							<Select.Content>
								{#each ['low', 'normal', 'high', 'urgent'] as p (p)}
									<Select.Item value={p}>{p}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</Field.Field>
					<Field.Field>
						<Field.Label for="d-start">Starts ({tz})</Field.Label>
						<Input id="d-start" type="datetime-local" bind:value={startsAt} disabled={locked} />
						<Field.Description
							>Clear the time to send this back to the unscheduled queue.</Field.Description
						>
					</Field.Field>
					<Field.Field>
						<Field.Label for="d-window">Arrival window</Field.Label>
						<Input
							id="d-window"
							placeholder="8-10 AM — shown to the customer"
							bind:value={arrivalWindow}
							disabled={locked}
						/>
					</Field.Field>
					<Field.Field>
						<Field.Label for="d-dur">Duration (minutes)</Field.Label>
						<Input
							id="d-dur"
							type="number"
							min={5}
							max={1440}
							bind:value={durationMin}
							disabled={locked}
						/>
					</Field.Field>
					<Field.Field>
						<Field.Label for="d-end">Ends ({tz})</Field.Label>
						<Input id="d-end" type="datetime-local" bind:value={endsAt} disabled={locked} />
						<Field.Description
							>Overrides duration — set a later date for multi-day jobs.</Field.Description
						>
					</Field.Field>
					<Field.Field class="sm:col-span-2">
						<Field.Label for="d-summary">Summary</Field.Label>
						<Input id="d-summary" bind:value={summary} disabled={locked} />
					</Field.Field>
					<Field.Field class="sm:col-span-2">
						<Field.Label for="d-desc">Notes</Field.Label>
						<Textarea id="d-desc" rows={4} bind:value={description} disabled={locked} />
					</Field.Field>
					<Field.Field class="sm:col-span-2">
						<Field.Label for="d-tags">Tags</Field.Label>
						<Input
							id="d-tags"
							bind:value={jobTags}
							disabled={locked}
							placeholder="callback, permit, VIP — comma-separated"
						/>
					</Field.Field>
					{#if !locked}
						<div class="sm:col-span-2">
							<Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button>
						</div>
					{/if}
				</form>
			</Card.Content>
		</Card.Root>
	</div>

	<!-- timeline -->
	<div class="space-y-6">
		<Card.Root>
			<Card.Header><Card.Title class="text-base">Status</Card.Title></Card.Header>
			<Card.Content class="space-y-2 px-4 text-sm">
				<div class="flex justify-between">
					<span class="text-muted-foreground">Status</span><StatusBadge status={j.job.status} />
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Priority</span><StatusBadge status={j.job.priority} />
					{#if j.job.rating}
						<span class="text-muted-foreground">Rating</span><span
							>{'★'.repeat(j.job.rating)}{'☆'.repeat(5 - j.job.rating)}{j.job.ratingNote
								? ` — ${j.job.ratingNote}`
								: ''}</span
						>
					{/if}
				</div>
				{#if j.job.status !== 'done' && !j.job.cancelledAt}
					<div class="flex items-center justify-between">
						<span class="text-muted-foreground">Waiting on parts</span>
						<Switch
							checked={j.job.blocked}
							onCheckedChange={async (v) => {
								await updateJob({ id, blocked: v }).updates(getJob, getJobs, getDispatchBoard);
								toast.success(v ? 'Flagged — shows on the dashboard' : 'Unblocked');
							}}
						/>
					</div>
					<div class="flex items-center justify-between">
						<span class="text-muted-foreground">Warranty — no charge</span>
						<Switch
							checked={j.job.warranty}
							onCheckedChange={async (v) => {
								await updateJob({ id, warranty: v }).updates(getJob, getJobs, getDispatchBoard);
								toast.success(v ? 'Marked warranty — no auto-invoice' : 'Billable again');
							}}
						/>
					</div>
				{/if}
				{#if j.job.warranty}
					<div class="flex justify-between">
						<span class="text-muted-foreground">Warranty</span>
						<Badge variant="secondary">no charge</Badge>
					</div>
				{/if}
				<div class="flex justify-between">
					<span class="text-muted-foreground">Source</span><span class="capitalize"
						>{j.job.source}</span
					>
				</div>
				{#if j.job.preferredTime}
					<div class="flex justify-between gap-3">
						<span class="text-muted-foreground">Customer asked for</span><span class="text-right"
							>{j.job.preferredTime}</span
						>
					</div>
				{/if}
				{#if j.job.arrivalWindow}
					<div class="flex justify-between gap-3">
						<span class="text-muted-foreground">Arrival window</span><span class="text-right"
							>{j.job.arrivalWindow}</span
						>
					</div>
				{/if}
				{#if j.job.completionNotes}
					<div class="flex justify-between gap-3">
						<span class="text-muted-foreground">Work performed</span><span class="text-right"
							>{j.job.completionNotes}</span
						>
					</div>
				{/if}
				<div class="flex justify-between">
					<span class="text-muted-foreground">Scheduled</span><span
						>{j.job.startsAt
							? `${localDate(j.job.startsAt, tz)} ${localTime(j.job.startsAt, tz)}`
							: '—'}</span
					>
				</div>
				{#if j.job.completedAt}
					<div class="flex justify-between">
						<span class="text-muted-foreground">Completed</span><span
							>{formatDate(j.job.completedAt)}</span
						>
					</div>
				{/if}
				{#if j.job.cancelledAt}
					<div class="flex justify-between gap-4">
						<span class="text-muted-foreground">Cancelled</span><span
							>{formatDate(j.job.cancelledAt)}{j.job.cancelReason
								? ` — ${j.job.cancelReason}`
								: ''}</span
						>
					</div>
				{/if}
				{#if j.job.estimateId}
					<div class="flex justify-between">
						<span class="text-muted-foreground">From estimate</span>
						<a href="/estimates/{j.job.estimateId}" class="hover:underline">View</a>
					</div>
				{/if}
				{#if j.openBalance > 0}
					<Separator />
					<div class="flex justify-between font-medium">
						<span>Open balance</span><span class="tabular-nums">{formatMoney(j.openBalance)}</span>
					</div>
				{/if}
			</Card.Content>
		</Card.Root>

		{#if j.job.signature || j.job.status !== 'cancelled'}
			<Card.Root>
				<Card.Header class="flex-row items-center justify-between space-y-0">
					<Card.Title class="text-base">Signature</Card.Title>
					{#if j.job.status !== 'cancelled'}
						<Button size="sm" variant="ghost" onclick={() => openSign(false)}
							><PenLine class="size-4" /> {j.job.signature ? 'Re-capture' : 'Capture'}</Button
						>
					{/if}
				</Card.Header>
				<Card.Content class="space-y-2">
					{#if j.job.signature}
						<img
							src={j.job.signature}
							alt="Customer signature"
							class="w-full rounded-md border bg-white"
						/>
						<p class="text-sm text-muted-foreground">
							Signed by {j.job.signedName}{#if j.job.signedAt}
								on {formatDate(j.job.signedAt)}{/if}
						</p>
					{:else}
						<p class="text-sm text-muted-foreground">
							No signature yet — capture the customer's sign-off on site.
						</p>
					{/if}
				</Card.Content>
			</Card.Root>
		{/if}

		<Card.Root>
			<Card.Header><Card.Title class="text-base">Costing</Card.Title></Card.Header>
			<Card.Content class="space-y-2 text-sm">
				<div class="flex justify-between">
					<span class="text-muted-foreground">Labor</span><span>{fmtDur(j.costing.laborMin)}</span>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Materials (cost)</span><span class="tabular-nums"
						>{formatMoney(j.costing.matCost, settings.currency)}</span
					>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Materials (sell)</span><span class="tabular-nums"
						>{formatMoney(j.costing.matSell, settings.currency)}</span
					>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Expenses</span><span class="tabular-nums"
						>{formatMoney(j.costing.expCost, settings.currency)}</span
					>
				</div>
				<Separator />
				<div class="flex justify-between">
					<span class="text-muted-foreground">Invoiced</span><span class="tabular-nums"
						>{formatMoney(j.costing.billed, settings.currency)}</span
					>
				</div>
				<div class="flex justify-between font-medium">
					<span>Margin</span><span
						class="tabular-nums {j.costing.billed - j.costing.matCost - j.costing.expCost < 0
							? 'text-destructive'
							: ''}"
						>{formatMoney(
							j.costing.billed - j.costing.matCost - j.costing.expCost,
							settings.currency
						)}</span
					>
				</div>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header class="flex-row items-center justify-between space-y-0">
				<Card.Title class="flex items-center gap-2 text-base"
					><Timer class="size-4" /> Time</Card.Title
				>
				<div class="flex items-center gap-2">
					{#if time.isAdmin && unapprovedCount > 0}
						<Button
							size="sm"
							variant="ghost"
							class="h-7 text-xs"
							disabled={approvingAll}
							onclick={approveAll}
						>
							Approve {unapprovedCount}
						</Button>
					{/if}
					<span class="text-sm text-muted-foreground tabular-nums"
						>{fmtDur(totalMin)}{#if time.entries.length > 1}
							· {time.entries.length} entries{/if}</span
					>
				</div>
			</Card.Header>
			<Card.Content class="space-y-3 px-4">
				{#if !locked && time.myMemberId}
					<Button
						size="sm"
						variant={time.mine ? 'destructive' : 'outline'}
						class="w-full"
						onclick={toggleTimer}
					>
						{#if time.mine}<Square /> Clock out{:else}<Play /> Clock in{/if}
					</Button>
				{/if}
				<ul class="space-y-2">
					{#each time.entries as e (e.entry.id)}
						<li class="flex items-start gap-2 text-sm">
							<div class="min-w-0 flex-1">
								<p>
									{e.memberName ?? 'Former member'}
									<span class="text-muted-foreground tabular-nums">
										· {e.entry.endedAt ? fmtDur(minutes(e.entry)) : 'Running'}
									</span>
								</p>
								<p class="text-xs text-muted-foreground">
									{localDate(e.entry.startedAt, tz)}
									{localTime(e.entry.startedAt, tz)}
									{#if e.entry.endedAt}– {localTime(e.entry.endedAt, tz)}{/if}
									{#if e.entry.note}
										· {e.entry.note}{/if}
								</p>
								{#if e.entry.approvedAt}
									<p class="text-xs font-medium text-emerald-600 dark:text-emerald-400">
										Approved{e.approvedByName ? ` · ${e.approvedByName}` : ''}
									</p>
								{/if}
							</div>
							{#if time.isAdmin && e.entry.endedAt}
								<Button
									variant="ghost"
									size="icon"
									class="size-7 {e.entry.approvedAt
										? 'text-emerald-600 dark:text-emerald-400'
										: 'text-muted-foreground'}"
									aria-label={e.entry.approvedAt ? 'Unapprove entry' : 'Approve entry'}
									title={e.entry.approvedAt
										? 'Approved — click to unapprove'
										: 'Approve for payroll'}
									onclick={() =>
										approveTimeEntry({ id: e.entry.id, approved: !e.entry.approvedAt }).updates(
											getTimeEntries
										)}
								>
									<CircleCheck class="size-3.5" />
								</Button>
							{/if}
							{#if time.isAdmin || e.entry.memberId === time.myMemberId}
								<div class="flex shrink-0">
									{#if !locked}
										<Button
											variant="ghost"
											size="icon"
											class="size-7 text-muted-foreground"
											aria-label="Edit time entry"
											onclick={() => startEditTime(e)}
										>
											<Pencil class="size-3.5" />
										</Button>
									{/if}
									<Button
										variant="ghost"
										size="icon"
										class="size-7 text-muted-foreground"
										aria-label="Delete time entry"
										onclick={() => removeTime(e.entry.id)}
									>
										<Trash2 class="size-3.5" />
									</Button>
								</div>
							{/if}
						</li>
					{:else}
						<li class="list-none">
							<Empty.Root class="border-0 py-4">
								<Empty.Header>
									<Empty.Media><Clock /></Empty.Media>
									<Empty.Title class="text-sm">No time logged yet</Empty.Title>
								</Empty.Header>
							</Empty.Root>
						</li>
					{/each}
				</ul>
				{#if !locked}
					{#if addingTime}
						<form class="grid gap-2 border-t pt-3" onsubmit={logTime}>
							{#if time.isAdmin && !editTimeId}
								<Select.Root type="single" bind:value={teMember}>
									<Select.Trigger class="w-full"
										>{technicians.find((t) => t.id === teMember)?.name ?? 'Me'}</Select.Trigger
									>
									<Select.Content>
										{#each technicians as t (t.id)}
											<Select.Item value={t.id}>{t.name}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							{/if}
							<Input type="datetime-local" bind:value={teStart} required aria-label="Start" />
							<Input
								type="datetime-local"
								bind:value={teEnd}
								aria-label="End (blank = still running)"
							/>
							<Input placeholder="Note (optional)" bind:value={teNote} />
							<label class="flex items-center gap-2 text-xs text-muted-foreground">
								Unpaid break
								<Input
									type="number"
									min={0}
									max={720}
									bind:value={teBreak}
									class="w-20"
									aria-label="Break minutes"
								/>
								min
							</label>
							<div class="flex gap-2">
								<Button type="submit" size="sm" disabled={!teStart}>Save</Button>
								<Button type="button" size="sm" variant="ghost" onclick={resetTimeForm}
									>Cancel</Button
								>
							</div>
						</form>
					{:else}
						<Button size="sm" variant="ghost" class="w-full" onclick={() => (addingTime = true)}>
							<Plus /> Log time
						</Button>
					{/if}
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header class="flex-row items-center justify-between space-y-0">
				<Card.Title class="flex items-center gap-2 text-base"
					><Package class="size-4" /> Materials</Card.Title
				>
				{#if materials.length}
					<span class="text-sm text-muted-foreground tabular-nums">
						{formatMoney(
							materials.reduce((s, m) => s + m.material.qty * m.material.unitPrice, 0),
							settings.currency
						)}
					</span>
				{/if}
			</Card.Header>
			<Card.Content class="space-y-3 px-4">
				<ul class="space-y-2">
					{#each materials as m (m.material.id)}
						<li class="flex items-start gap-2 text-sm">
							<div class="min-w-0 flex-1">
								<p>
									{m.material.qty} × {m.itemName ?? m.material.customName}
									{#if m.material.unitPrice}
										<span class="text-muted-foreground tabular-nums">
											· {formatMoney(m.material.qty * m.material.unitPrice, settings.currency)}
										</span>
									{/if}
								</p>
								<p class="text-xs text-muted-foreground">
									{#if m.memberName}{m.memberName} ·
									{/if}{localDate(m.material.createdAt, tz)}
									{#if m.material.sourceMemberId}
										<Badge variant="outline" class="ml-1">from truck</Badge>
									{/if}
									{#if m.itemName && !m.itemBillable}
										<Badge variant="outline" class="ml-1">non-billable</Badge>
									{:else if !m.itemName}
										<Badge variant="outline" class="ml-1">custom</Badge>
									{/if}
								</p>
							</div>
							{#if !locked}
								<Button
									variant="ghost"
									size="icon"
									class="size-7 shrink-0 text-muted-foreground"
									onclick={() => removeMat(m.material.id)}
								>
									<Trash2 class="size-3.5" />
								</Button>
							{/if}
						</li>
					{:else}
						<li class="list-none">
							<Empty.Root class="border-0 py-4">
								<Empty.Header>
									<Empty.Media><Package /></Empty.Media>
									<Empty.Title class="text-sm">No materials used yet</Empty.Title>
								</Empty.Header>
							</Empty.Root>
						</li>
					{/each}
				</ul>
				{#if !locked}
					{#if addingMat}
						<form class="grid gap-2 border-t pt-3" onsubmit={logMaterial}>
							<Select.Root type="single" value={matItem} onValueChange={pickMat}>
								<Select.Trigger class="w-full"
									>{matItem === '__custom'
										? 'Custom — not in inventory'
										: (stock.find((s) => s.item.id === matItem)?.item.name ??
											'Pick an item…')}</Select.Trigger
								>
								<Select.Content>
									<Select.Item value="__custom">Custom — not in inventory</Select.Item>
									{#each stock as s (s.item.id)}
										<Select.Item value={s.item.id}
											>{s.item.name}
											<span class="text-muted-foreground">({s.item.qtyOnHand} {s.item.unit})</span
											></Select.Item
										>
									{/each}
								</Select.Content>
							</Select.Root>
							{#if matItem === '__custom'}
								<Input
									bind:value={matCustom}
									placeholder="Part name (e.g. 40A breaker)"
									aria-label="Part name"
								/>
							{/if}
							<div class="grid grid-cols-2 gap-2">
								<Input
									type="number"
									min={1}
									placeholder="Qty"
									aria-label="Quantity"
									bind:value={matQty}
								/>
								<MoneyInput bind:value={matPrice} placeholder="Unit price" />
							</div>
							{#if j.job.technicianId && matItem && matItem !== '__custom'}
								<Select.Root
									type="single"
									value={matSource}
									onValueChange={(v) => (matSource = v as 'warehouse' | 'truck')}
								>
									<Select.Trigger class="w-full"
										>From: {matSource === 'truck'
											? `${matTechName}'s truck`
											: 'Warehouse'}</Select.Trigger
									>
									<Select.Content>
										<Select.Item value="warehouse"
											>Warehouse ({stock.find((s) => s.item.id === matItem)?.item.qtyOnHand ?? 0} on hand)</Select.Item
										>
										<Select.Item value="truck" disabled={truckQty < 1}
											>{matTechName}'s truck ({truckQty})</Select.Item
										>
									</Select.Content>
								</Select.Root>
							{/if}
							<div class="flex gap-2">
								<Button
									type="submit"
									size="sm"
									disabled={!matItem || matQty < 1 || (matItem === '__custom' && !matCustom.trim())}
									>Log</Button
								>
								<Button type="button" size="sm" variant="ghost" onclick={() => (addingMat = false)}
									>Cancel</Button
								>
							</div>
						</form>
					{:else}
						<Button
							size="sm"
							variant="ghost"
							class="w-full"
							disabled={!stock.length}
							onclick={() => (addingMat = true)}
						>
							<Plus />
							{stock.length ? 'Log material' : 'Add stock items in Inventory first'}
						</Button>
						{#if jobKit.length}
							<Button
								size="sm"
								variant="ghost"
								class="w-full"
								disabled={applyingKit}
								title="Log this job type's default materials ({jobKit.length} items)"
								onclick={applyKit}
							>
								<Package class="size-3.5" />
								{applyingKit ? 'Adding…' : `Add kit (${jobKit.length} items)`}
							</Button>
						{/if}
					{/if}
					{#if materials.length}
						<Button
							size="sm"
							variant="ghost"
							class="w-full"
							disabled={ordering}
							title="Draft a purchase order for this job's logged materials"
							onclick={orderParts}
						>
							<Package class="size-3.5" />
							{ordering ? 'Drafting…' : 'Order parts'}
						</Button>
					{/if}
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header class="flex-row items-center justify-between space-y-0">
				<Card.Title class="flex items-center gap-2 text-base"
					><ReceiptText class="size-4" /> Expenses</Card.Title
				>
				{#if expenses.length}
					<span class="text-sm text-muted-foreground tabular-nums">
						{formatMoney(
							expenses.reduce((s, x) => s + x.expense.amount, 0),
							settings.currency
						)}
					</span>
				{/if}
			</Card.Header>
			<Card.Content class="space-y-3 px-4">
				<ul class="space-y-2">
					{#each expenses as x (x.expense.id)}
						<li class="flex items-start gap-2 text-sm">
							<div class="min-w-0 flex-1">
								<p>
									{x.expense.description}
									<span class="text-muted-foreground tabular-nums">
										· {formatMoney(x.expense.amount, settings.currency)}
									</span>
								</p>
								<p class="text-xs text-muted-foreground">
									{#if x.expense.vendor}{x.expense.vendor} ·
									{/if}{#if x.expense.incurredOn}{x.expense.incurredOn} ·
									{/if}{#if x.memberName}{x.memberName} ·
									{/if}{localDate(x.expense.createdAt, tz)}
								</p>
							</div>
							{#if !locked}
								<Button
									variant="ghost"
									size="icon"
									class="size-7 shrink-0 text-muted-foreground"
									onclick={() => removeExp(x.expense.id)}
								>
									<Trash2 class="size-3.5" />
								</Button>
							{/if}
						</li>
					{:else}
						<li class="list-none">
							<Empty.Root class="border-0 py-4">
								<Empty.Header>
									<Empty.Media><Receipt /></Empty.Media>
									<Empty.Title class="text-sm">No expenses yet</Empty.Title>
									<Empty.Description>Permits, subcontractors, dump fees.</Empty.Description>
								</Empty.Header>
							</Empty.Root>
						</li>
					{/each}
				</ul>
				{#if !locked}
					{#if addingExp}
						<form class="grid gap-2 border-t pt-3" onsubmit={logExpense}>
							<Input placeholder="Description (e.g. City permit)" bind:value={expDesc} />
							<Input placeholder="Vendor (optional)" bind:value={expVendor} />
							<div class="grid grid-cols-2 gap-2">
								<MoneyInput bind:value={expAmount} placeholder="Amount" />
								<Input type="date" aria-label="Date incurred" bind:value={expOn} />
							</div>
							<div class="flex gap-2">
								<Button type="submit" size="sm" disabled={!expDesc.trim()}>Log</Button>
								<Button type="button" size="sm" variant="ghost" onclick={() => (addingExp = false)}
									>Cancel</Button
								>
							</div>
						</form>
					{:else}
						<Button size="sm" variant="ghost" class="w-full" onclick={() => (addingExp = true)}>
							<Plus /> Log expense
						</Button>
					{/if}
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header class="flex-row items-center justify-between space-y-0">
				<Card.Title class="flex items-center gap-2 text-base"
					><Camera class="size-4" /> Photos</Card.Title
				>
				{#if photos.length}
					<span class="text-sm text-muted-foreground tabular-nums">{photos.length}</span>
				{/if}
			</Card.Header>
			<Card.Content class="px-4">
				{#if photos.length}
					<ul class="grid grid-cols-3 gap-2">
						{#each photos as p (p.id)}
							<li class="group relative">
								<button type="button" class="w-full cursor-zoom-in" onclick={() => (lightbox = p)}>
									<img
										src="/files/job-photo/{p.id}"
										alt={p.fileName}
										class="aspect-square w-full rounded-md border object-cover"
										loading="lazy"
									/>
								</button>
								{#if !locked}
									<div
										class="absolute top-1 right-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100"
									>
										<Button
											variant="secondary"
											size="icon"
											class="size-6 {p.shared ? 'opacity-100 ring-2 ring-primary' : ''}"
											title={p.shared
												? 'Shared with customer — click to hide'
												: 'Share on customer portal'}
											aria-label={p.shared ? 'Hide from portal' : 'Share on portal'}
											onclick={() => toggleShare(p)}
										>
											<Eye class="size-3" />
										</Button>
										<Button
											variant="destructive"
											size="icon"
											class="size-6"
											onclick={() => removePhoto(p.id)}
											aria-label="Delete photo"
										>
											<Trash2 class="size-3" />
										</Button>
									</div>
									{#if p.phase}
										<Badge class="absolute bottom-1 left-1 bg-background/90 text-[10px] capitalize"
											>{p.phase}</Badge
										>
									{/if}
									{#if p.shared}
										<Badge
											class="absolute top-1 left-1 bg-primary text-[10px] text-primary-foreground"
											>Portal</Badge
										>
									{/if}
								{/if}
							</li>
						{/each}
					</ul>
				{:else}
					<Empty.Root class="border-0 py-4">
						<Empty.Header>
							<Empty.Media><Image /></Empty.Media>
							<Empty.Title class="text-sm">No photos yet</Empty.Title>
							<Empty.Description>Upload before / during / after shots below.</Empty.Description>
						</Empty.Header>
					</Empty.Root>
				{/if}
				{#if !locked}
					<Select.Root type="single" bind:value={photoPhase}>
						<Select.Trigger class="mt-3 h-8 w-28 text-xs capitalize">{photoPhase}</Select.Trigger>
						<Select.Content>
							<Select.Item value="before">Before</Select.Item>
							<Select.Item value="during">During</Select.Item>
							<Select.Item value="after">After</Select.Item>
						</Select.Content>
					</Select.Root>
					<label
						class="mt-2 flex items-center justify-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground transition-colors hover:bg-accent {uploading
							? 'pointer-events-none opacity-60'
							: 'cursor-pointer'}"
					>
						<Camera class="size-4" />
						{uploading ? 'Uploading…' : 'Add a photo'}
						<input
							type="file"
							accept="image/*"
							class="sr-only"
							disabled={uploading}
							onchange={uploadPhoto}
						/>
					</label>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header class="flex-row items-center justify-between space-y-0">
				<Card.Title class="flex items-center gap-2 text-base"
					><Paperclip class="size-4" /> Documents</Card.Title
				>
				{#if jobDocs.length}
					<span class="text-sm text-muted-foreground tabular-nums">{jobDocs.length}</span>
				{/if}
			</Card.Header>
			<Card.Content class="px-4">
				{#if jobDocs.length}
					<ul class="space-y-1.5">
						{#each jobDocs as doc (doc.id)}
							<li class="group flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
								<FileText class="size-4 shrink-0 text-muted-foreground" />
								<a
									href="/files/job-document/{doc.id}"
									target="_blank"
									class="min-w-0 flex-1 truncate font-medium hover:underline">{doc.fileName}</a
								>
								{#if doc.shared}
									<Badge class="shrink-0 bg-primary text-[10px] text-primary-foreground"
										>Portal</Badge
									>
								{/if}
								<span class="shrink-0 text-xs text-muted-foreground">{docSize(doc.size)}</span>
								{#if !locked}
									<Button
										variant="secondary"
										size="icon"
										class="size-6 opacity-0 transition-opacity group-hover:opacity-100"
										title={doc.shared
											? 'Shared with customer — click to hide'
											: 'Share on customer portal'}
										aria-label={doc.shared ? 'Hide from portal' : 'Share on portal'}
										onclick={() => toggleDocShare(doc)}
									>
										<Eye class="size-3" />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										class="size-6 opacity-0 transition-opacity group-hover:opacity-100"
										onclick={() => removeDoc(doc.id)}
										aria-label="Delete document"
									>
										<Trash2 class="size-3" />
									</Button>
								{/if}
							</li>
						{/each}
					</ul>
				{:else}
					<p class="py-1 text-xs text-muted-foreground">
						Permits, contracts and signed paperwork for this job.
					</p>
				{/if}
				{#if !locked}
					<label
						class="mt-2 flex items-center justify-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground transition-colors hover:bg-accent {docUploading
							? 'pointer-events-none opacity-60'
							: 'cursor-pointer'}"
					>
						<Paperclip class="size-4" />
						{docUploading ? 'Uploading…' : 'Attach a file'}
						<input type="file" class="sr-only" disabled={docUploading} onchange={uploadDoc} />
					</label>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header class="flex-row items-center justify-between space-y-0">
				<Card.Title class="flex items-center gap-2 text-base"
					><ListChecks class="size-4" /> Checklist</Card.Title
				>
				{#if checklist.length}
					<div class="flex items-center gap-2">
						<Progress value={checkDone} max={checklist.length} class="h-1.5 w-16" />
						<span class="text-sm text-muted-foreground tabular-nums"
							>{checkDone}/{checklist.length} done</span
						>
					</div>
				{/if}
			</Card.Header>
			<Card.Content class="space-y-2 px-4">
				<ul class="space-y-1.5">
					{#each checklist as item (item.id)}
						<li class="flex items-center gap-2 text-sm">
							<Checkbox
								checked={item.done}
								disabled={locked}
								onCheckedChange={() => toggleCheck(item)}
							/>
							<span class="min-w-0 flex-1 {item.done ? 'text-muted-foreground line-through' : ''}"
								>{item.label}</span
							>
							{#if !locked}
								<Button
									variant="ghost"
									size="icon"
									class="size-7 shrink-0 text-muted-foreground"
									onclick={() => delCheck(item.id)}
								>
									<Trash2 class="size-3.5" />
								</Button>
							{/if}
						</li>
					{:else}
						<li class="text-sm text-muted-foreground">
							No checklist items — add one, or set a template on the job type.
						</li>
					{/each}
				</ul>
				{#if !locked}
					<form class="flex gap-2 border-t pt-3" onsubmit={addCheck}>
						<Input placeholder="Add a step…" bind:value={newCheck} />
						<Button type="submit" size="sm" variant="outline" disabled={!newCheck.trim()}
							>Add</Button
						>
					</form>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header class="flex-row items-center justify-between space-y-0">
				<Card.Title class="flex items-center gap-2 text-base"
					><BellPlus class="size-4" /> Follow-ups{#if j.followUps.filter((f) => !f.doneAt).length}
						<span class="text-xs font-normal text-muted-foreground"
							>({j.followUps.filter((f) => !f.doneAt).length} open)</span
						>{/if}</Card.Title
				>
				<Button size="sm" variant="outline" onclick={openFollowUp}>Add</Button>
			</Card.Header>
			<Card.Content class="space-y-2 px-4">
				{#each j.followUps as f (f.id)}
					<div
						class="flex items-center justify-between gap-2 rounded-lg border p-2.5 text-sm {f.doneAt
							? 'opacity-50'
							: ''}"
					>
						<div class="min-w-0 flex-1">
							<span class="font-medium">{f.note}</span>
							<span class="mt-0.5 flex items-center gap-2 text-xs">
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
									<DropdownMenu.Item onclick={() => completeFollowUp(f.id).updates(getJob)}
										>Mark done</DropdownMenu.Item
									>
								{/if}
								<DropdownMenu.Item
									class="text-destructive"
									onclick={() => removeFollowUp(f.id).updates(getJob)}>Remove</DropdownMenu.Item
								>
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">
						No follow-ups — add one to remember a callback or check-in.
					</p>
				{/each}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header><Card.Title class="text-base">Timeline</Card.Title></Card.Header>
			<Card.Content class="px-4">
				<ul class="space-y-3">
					{#each j.events as e (e.event.id)}
						<li class="flex items-start gap-2 text-sm">
							<span class="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/40"></span>
							<div class="min-w-0">
								<p class="capitalize">
									{e.event.kind.replace('_', ' ')}
									{#if e.memberName}<span class="text-muted-foreground">· {e.memberName}</span>{/if}
								</p>
								{#if e.event.note}<p class="text-muted-foreground">{e.event.note}</p>{/if}
								<p class="text-xs text-muted-foreground">
									{formatRelative(e.event.at)}{#if e.event.lat != null && e.event.lng != null}
										·
										<a
											class="underline"
											href="https://www.openstreetmap.org/?mlat={e.event.lat}&mlon={e.event
												.lng}#map=17/{e.event.lat}/{e.event.lng}"
											target="_blank"
											rel="noreferrer">map</a
										>{/if}
								</p>
							</div>
						</li>
					{:else}
						<li class="list-none">
							<Empty.Root class="border-0 py-4">
								<Empty.Header>
									<Empty.Media><History /></Empty.Media>
									<Empty.Title class="text-sm">No activity yet</Empty.Title>
								</Empty.Header>
							</Empty.Root>
						</li>
					{/each}
				</ul>
				{#if !locked}
					<form class="mt-4 flex gap-2" onsubmit={addNote}>
						<Input placeholder="Add a note…" bind:value={note} />
						<Button type="submit" variant="secondary" disabled={!note.trim()}>Add</Button>
					</form>
				{/if}
			</Card.Content>
		</Card.Root>
	</div>
</div>

<!-- add follow-up -->
<Dialog.Root bind:open={fupOpen}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>New follow-up</Dialog.Title>
			<Dialog.Description
				>A dated reminder linked to this job — it shows on the dashboard when due.</Dialog.Description
			>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={saveFollowUp}>
			<Field.Field>
				<Field.Label for="fup-note">Note</Field.Label>
				<Input id="fup-note" bind:value={fupNote} placeholder="Check the part arrived…" required />
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

<SignatureDialog
	bind:open={signOpen}
	pending={signPending}
	onSave={saveSignature}
	skipLabel="Complete without signature"
	bind:note={completionNote}
	onSkip={() => {
		signOpen = false;
		if (signThenComplete) event('completed', completionNote);
		signThenComplete = false;
	}}
/>

<!-- cancel reason -->
<Dialog.Root bind:open={etaOpen}>
	<Dialog.Content class="sm:max-w-xs">
		<Dialog.Header>
			<Dialog.Title>Text an ETA</Dialog.Title>
			<Dialog.Description
				>Text {j.customerName} that you're on the way — roughly how many minutes out?</Dialog.Description
			>
		</Dialog.Header>
		<div class="flex flex-wrap gap-2">
			{#each [15, 30, 45, 60, 90] as m (m)}
				<Button variant="outline" size="sm" disabled={etaPending} onclick={() => sendEta(m)}
					>{m} min</Button
				>
			{/each}
		</div>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={cancelOpen}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Cancel J-{j.job.number}?</Dialog.Title>
			<Dialog.Description>
				The job is removed from the schedule and any open timers are stopped.
			</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={cancel}>
			<Field.Field>
				<Field.Label for="cancel-reason">Reason (optional)</Field.Label>
				<Input
					id="cancel-reason"
					bind:value={cancelReason}
					placeholder="e.g. customer rescheduled, duplicate job"
				/>
			</Field.Field>
			<Dialog.Footer>
				<Button type="submit" variant="destructive" disabled={cancelling}
					>{cancelling ? 'Cancelling…' : 'Cancel job'}</Button
				>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<!-- repeat series -->
<Dialog.Root bind:open={repeatOpen}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Repeat this job</Dialog.Title>
			<Dialog.Description>
				Creates copies of J-{j.job.number}
				{j.job.startsAt ? ' at the same time of day' : ' in the unscheduled queue'}.
			</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={repeat}>
			<div class="grid grid-cols-2 gap-4">
				<Field.Field>
					<Field.Label for="rp-every">Every N weeks</Field.Label>
					<Input id="rp-every" type="number" min={1} max={52} bind:value={repeatWeeks} />
				</Field.Field>
				<Field.Field>
					<Field.Label for="rp-count">Visits</Field.Label>
					<Input id="rp-count" type="number" min={1} max={24} bind:value={repeatCount} />
				</Field.Field>
			</div>
			<Dialog.Footer>
				<Button type="submit" disabled={repeating}
					>{repeating
						? 'Booking…'
						: `Book ${repeatCount} visit${repeatCount > 1 ? 's' : ''}`}</Button
				>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root open={!!lightbox} onOpenChange={(v) => !v && (lightbox = null)}>
	<Dialog.Content class="max-w-3xl p-2 sm:p-4">
		{#if lightbox}
			<img
				src="/files/job-photo/{lightbox.id}"
				alt={lightbox.fileName}
				class="max-h-[80vh] w-full rounded-md object-contain"
			/>
			<p class="mt-2 flex items-center justify-between px-1 text-xs text-muted-foreground">
				<span class="truncate">{lightbox.fileName}</span>
				{#if lightbox.phase}<Badge variant="outline" class="capitalize">{lightbox.phase}</Badge
					>{/if}
			</p>
		{/if}
	</Dialog.Content>
</Dialog.Root>
