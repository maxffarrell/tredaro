<script lang="ts">
	import * as Empty from '#lib/components/ui/empty/index.js';
	import { goto } from '$app/navigation';
	import PageHeader from '#lib/components/app/page-header.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import {
		convertWaitlistEntry,
		copyWeek,
		getDispatchBoard,
		moveDayStop,
		reviewBooking,
		sendDayEtas,
		updateJob,
		updateWaitlistStatus
	} from '#lib/remote/jobs.remote.ts';
	import { setDayNote } from '#lib/remote/followups.remote.ts';
	import { getAiStatus, aiDispatchSuggestion } from '#lib/remote/ai.remote.ts';
	import { getOffices, getSettings } from '#lib/remote/workspace.remote.ts';
	import * as Select from '#lib/components/ui/select/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { localDate, localTime } from '#lib/tz.ts';
	import { addDays } from '#lib/tz.ts';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { errMsg, formatRelative } from '#lib/format.ts';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Inbox from '@lucide/svelte/icons/inbox';
	import Printer from '@lucide/svelte/icons/printer';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import CalendarPlus from '@lucide/svelte/icons/calendar-plus';
	import StickyNote from '@lucide/svelte/icons/sticky-note';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import ChevronsUp from '@lucide/svelte/icons/chevrons-up';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Sparkles from '@lucide/svelte/icons/sparkles';

	const settings = await getSettings();
	const offices = await getOffices();
	let officeId = $state(page.url.searchParams.get('office') ?? '');
	let queueFilter = $state('');
	let dayFilter = $state('');
	const weekDays = $derived(Array.from({ length: 7 }, (_, i) => addDays(start, i)));
	const coversDay = (j: (typeof board.scheduled)[number], day: string) => {
		if (!j.job.startsAt) return false;
		const startDay = localDate(new Date(j.job.startsAt), tz);
		const endDay = j.job.endsAt ? localDate(new Date(j.job.endsAt), tz) : startDay;
		return startDay <= day && day <= endDay;
	};
	const dayJobs = (jobs: (typeof board.scheduled)[number][]) => {
		const rows = dayFilter ? jobs.filter((j) => coversDay(j, dayFilter)) : jobs;
		if (!dayFilter) return rows;
		return rows
			.slice()
			.sort(
				(a, b) =>
					(a.job.routeOrder ?? Number.MAX_SAFE_INTEGER) -
						(b.job.routeOrder ?? Number.MAX_SAFE_INTEGER) ||
					(a.job.startsAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
						(b.job.startsAt?.getTime() ?? Number.MAX_SAFE_INTEGER)
			);
	};
	const officeName = $derived(offices.find((o) => o.id === officeId)?.name ?? '');
	const tz = settings.timezone;

	const todayStr = localDate(new Date(), tz);
	const ai = await getAiStatus();

	// ------- AI dispatch suggestions -------
	let suggestOpen = $state(false);
	let suggestPending = $state(false);
	let suggestions = $state<{ jobId: string; memberId: string; reason: string }[]>([]);
	async function aiSuggest() {
		suggestPending = true;
		try {
			const r = await aiDispatchSuggestion({ day: dayFilter || todayStr });
			suggestions = r.suggestions;
			suggestOpen = true;
		} catch (err) {
			toast.error(errMsg(err, 'Could not get suggestions'));
		}
		suggestPending = false;
	}
	async function applySuggestion(jobId: string, memberId: string) {
		const day = dayFilter || todayStr;
		const toInput = (d: Date | string) => `${localDate(new Date(d), tz)}T${localTime(d, tz)}`;
		const lastEnd = board.scheduled
			.filter(
				(j) =>
					j.job.technicianId === memberId &&
					j.job.startsAt &&
					localDate(new Date(j.job.startsAt), tz) === day
			)
			.map((j) => j.job.endsAt)
			.filter((d): d is Date => !!d)
			.sort((a, b) => a.getTime() - b.getTime())
			.at(-1);
		const when = lastEnd ? toInput(lastEnd) : `${day}T08:00`;
		try {
			await updateJob({ id: jobId, technicianId: memberId, startsAt: when }).updates(
				getDispatchBoard
			);
			toast.success('Assigned');
			suggestions = suggestions.filter((s) => s.jobId !== jobId);
			if (!suggestions.length) suggestOpen = false;
		} catch (err) {
			toast.error(errMsg(err, 'Could not assign'));
		}
	}
	let start = $state(page.url.searchParams.get('from') ?? todayStr);
	let etaPending = $state(false);

	// ------- per-tech day note -------
	let noteOpen = $state(false);
	let notePending = $state(false);
	let noteMemberId = $state('');
	let noteOn = $state('');
	let noteText = $state('');
	let noteName = $state('');

	function openDayNote(techId: string, name: string) {
		noteMemberId = techId;
		noteName = name;
		noteOn = dayFilter || todayStr;
		noteText = board.dayNotes.find((n) => n.memberId === techId && n.on === noteOn)?.note ?? '';
		noteOpen = true;
	}

	async function saveDayNote(e: SubmitEvent) {
		e.preventDefault();
		notePending = true;
		try {
			await setDayNote({ memberId: noteMemberId, on: noteOn, note: noteText.trim() }).updates(
				getDispatchBoard
			);
			toast.success(noteText.trim() ? 'Note saved' : 'Note cleared');
			noteOpen = false;
		} catch (err) {
			toast.error(errMsg(err, 'Could not save note'));
		}
		notePending = false;
	}

	async function textEtas() {
		const day = dayFilter || todayStr;
		etaPending = true;
		try {
			const r = await sendDayEtas({ day });
			toast.success(
				`${r.sent} ETA text${r.sent === 1 ? '' : 's'} sent${r.skipped ? ` (${r.skipped} skipped)` : ''}`
			);
		} catch (err) {
			toast.error(errMsg(err, 'Could not send ETA texts'));
		}
		etaPending = false;
	}
	let copyPending = $state(false);

	async function copyThisWeek() {
		copyPending = true;
		try {
			const r = await copyWeek({ weekStart: start });
			toast.success(
				`${r.created} job${r.created === 1 ? '' : 's'} copied to next week${r.skipped ? ` (${r.skipped} skipped — conflict or off-day)` : ''}`
			);
		} catch (err) {
			toast.error(errMsg(err, 'Could not copy the week'));
		}
		copyPending = false;
	}
	const board = $derived(
		await getDispatchBoard({ from: start, to: addDays(start, 7), officeId: officeId || undefined })
	);
	const offThisWeek = $derived(
		board
			? new Set(
					board.timeOff
						.filter((t) => t.startsOn <= addDays(start, 7) && t.endsOn >= start)
						.map((t) => t.memberId)
				).size
			: 0
	);
	const offToday = $derived(
		board ? board.timeOff.filter((t) => t.startsOn <= todayStr && t.endsOn >= todayStr).length : 0
	);
	const schedTodayMin = $derived(
		board
			? board.scheduled
					.filter(
						(j) =>
							j.job.startsAt &&
							j.job.endsAt &&
							j.job.status !== 'cancelled' &&
							localDate(new Date(j.job.startsAt), tz) === todayStr
					)
					.reduce(
						(m, j) =>
							m + ((j.job.endsAt?.getTime() ?? 0) - (j.job.startsAt?.getTime() ?? 0)) / 60_000,
						0
					)
			: 0
	);
	const techsOn = $derived.by(() => {
		if (!board) return 0;
		return new Set(
			board.scheduled
				.filter(
					(j) =>
						j.job.startsAt &&
						j.job.technicianId &&
						!['done', 'cancelled'].includes(j.job.status) &&
						localDate(new Date(j.job.startsAt), tz) === todayStr
				)
				.map((j) => j.job.technicianId)
		).size;
	});
	const avgPerTechToday = $derived.by(() => {
		if (!board || !board.technicians.length) return null;
		const todayJobs = board.scheduled.filter(
			(j) =>
				j.job.startsAt &&
				localDate(new Date(j.job.startsAt), tz) === todayStr &&
				!['done', 'cancelled'].includes(j.job.status)
		).length;
		return todayJobs ? todayJobs / board.technicians.length : null;
	});
	const peakDay = $derived.by(() => {
		if (!board) return null;
		const counts = new SvelteMap<string, number>();
		for (const j of board.scheduled) {
			if (!j.job.startsAt || ['done', 'cancelled'].includes(j.job.status)) continue;
			const d = localDate(new Date(j.job.startsAt), tz);
			counts.set(d, (counts.get(d) ?? 0) + 1);
		}
		const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
		return top && top[1] > 1 ? top : null;
	});
	const bookedOnline = $derived(
		board ? board.scheduled.filter((j) => j.job.source === 'booking').length : 0
	);
	const weekCount = $derived(
		board ? board.scheduled.filter((j) => !['done', 'cancelled'].includes(j.job.status)).length : 0
	);
	const unassignedToday = $derived(
		board
			? board.scheduled.filter(
					(j) =>
						!j.job.technicianId &&
						j.job.startsAt &&
						localDate(new Date(j.job.startsAt), tz) === todayStr &&
						!['done', 'cancelled'].includes(j.job.status)
				).length
			: 0
	);
	const doneThisWeek = $derived(board.scheduled.filter((j) => j.job.status === 'done').length);
	const onSiteNow = $derived(board.scheduled.filter((j) => j.job.status === 'in_progress').length);
	let queueSort = $state<'priority' | 'oldest'>('priority');
	const filteredQueue = $derived.by(() => {
		const q = queueFilter.trim()
			? board.unscheduled.filter((j) =>
					`${j.job.summary} ${j.jobTypeName} ${j.customerName} J-${j.job.number}`
						.toLowerCase()
						.includes(queueFilter.trim().toLowerCase())
				)
			: board.unscheduled;
		if (queueSort === 'oldest')
			return [...q].sort(
				(a, b) => new Date(a.job.createdAt).getTime() - new Date(b.job.createdAt).getTime()
			);
		return q;
	});

	const queueRequests = $derived(filteredQueue.filter((j) => j.job.source === 'booking'));
	const queueOthers = $derived(filteredQueue.filter((j) => j.job.source !== 'booking'));

	let reviewBusy = $state('');
	let waitlistBusy = $state('');
	async function setWaitlist(id: string, status: 'contacted' | 'closed') {
		waitlistBusy = id;
		try {
			await updateWaitlistStatus({ id, status }).updates(getDispatchBoard);
		} catch (err) {
			toast.error(errMsg(err, 'Could not update'));
		}
		waitlistBusy = '';
	}
	async function bookWaitlist(id: string) {
		waitlistBusy = id;
		try {
			const j = await convertWaitlistEntry({ id }).updates(getDispatchBoard);
			if (j) {
				toast.success(`Job J-${j.number} created`);
				goto(`/jobs/${j.id}`);
			}
		} catch (err) {
			toast.error(errMsg(err, 'Could not book'));
		}
		waitlistBusy = '';
	}
	async function review(jobId: string, approve: boolean) {
		reviewBusy = jobId;
		try {
			await reviewBooking({ jobId, approve }).updates(getDispatchBoard);
			toast[approve ? 'success' : 'info'](approve ? 'Booking accepted' : 'Booking declined');
		} catch (err) {
			toast.error(errMsg(err, 'Review failed'));
		}
		reviewBusy = '';
	}

	const waitingDays = (created: Date | string) =>
		Math.max(0, Math.floor((Date.now() - new Date(created).getTime()) / 86_400_000));

	// ------- bulk assign -------
	const selected = new SvelteSet<string>();
	let bulkTech = $state('');
	let bulkBusy = $state(false);
	function toggleSelect(id: string) {
		if (selected.has(id)) selected.delete(id);
		else selected.add(id);
	}
	async function assignSelected() {
		if (!selected.size || !bulkTech) return;
		bulkBusy = true;
		// Back-to-back from 8am on the board's first day, each slot as long as its job.
		let cursor = 8 * 60;
		try {
			for (const id of [...selected]) {
				const j = board.unscheduled.find((x) => x.job.id === id);
				const hh = String(Math.floor(cursor / 60)).padStart(2, '0');
				const mm = String(cursor % 60).padStart(2, '0');
				await updateJob({ id, technicianId: bulkTech, startsAt: `${start}T${hh}:${mm}` }).updates(
					getDispatchBoard
				);
				cursor += j?.typeDurationMin ?? 60;
			}
			const misses = [...selected].filter((id) => {
				const j = board.unscheduled.find((x) => x.job.id === id);
				const t = board.technicians.find((x) => x.id === bulkTech);
				return j && t && !qualifiedFor(t, j.job.jobTypeId);
			}).length;
			toast.success(`Assigned ${selected.size} job${selected.size > 1 ? 's' : ''}`);
			if (misses)
				toast.warning(
					`${misses} assigned job${misses > 1 ? "s aren't" : " isn't"} tagged for the tech`
				);
			selected.clear();
		} catch (err) {
			toast.error(errMsg(err, 'Bulk assign failed'));
		} finally {
			bulkBusy = false;
		}
	}

	function shift(days: number) {
		start = addDays(start, days);
		goto(`?from=${start}`, { replaceState: true });
	}

	// ------- drag to reassign / unschedule -------
	let dropZone = $state<string | null>(null);
	function dragJob(e: DragEvent, j: { job: { id: string } }) {
		e.dataTransfer?.setData('text/plain', j.job.id);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
	}
	function allowDrop(e: DragEvent) {
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
	}
	async function dropOn(e: DragEvent, techId: string | 'queue', afterJobId?: string) {
		e.preventDefault();
		dropZone = null;
		const jobId = e.dataTransfer?.getData('text/plain');
		if (!jobId) return;
		try {
			if (techId === 'queue') {
				await updateJob({ id: jobId, startsAt: null }).updates(getDispatchBoard);
				toast.success('Job unscheduled');
			} else {
				// Unscheduled jobs dropped on a tech slot in after that tech's last job of the
				// day (or right after the job card it was dropped on), not always at 8am.
				const job = board.unscheduled.find((j) => j.job.id === jobId);
				const toInput = (d: Date | string) => `${localDate(new Date(d), tz)}T${localTime(d, tz)}`;
				let when = `${start}T08:00`;
				if (job) {
					const group = byTech.find(([id]) => id === techId)?.[1];
					const dayJobs = (group?.jobs ?? []).filter(
						(j) => j.job.startsAt && localDate(new Date(j.job.startsAt), tz) === start
					);
					const after = afterJobId ? dayJobs.find((j) => j.job.id === afterJobId) : null;
					const last = after?.job.endsAt
						? after.job.endsAt
						: dayJobs
								.map((j) => j.job.endsAt)
								.filter((d): d is Date => !!d)
								.sort((a, b) => a.getTime() - b.getTime())
								.at(-1);
					if (last) when = toInput(last);
				}
				await updateJob({
					id: jobId,
					technicianId: techId || null,
					...(job ? { startsAt: when } : {})
				}).updates(getDispatchBoard);
				toast.success('Job reassigned');
				// Dragged job may come from the scheduled list too — resolve its type.
				const dragged =
					job ??
					board.scheduled.find((x) => x.job.id === jobId) ??
					board.unscheduled.find((x) => x.job.id === jobId);
				if (dragged) warnIfUnqualified(dragged.job.jobTypeId, techId || null);
			}
		} catch (err) {
			toast.error(errMsg(err, 'Could not move job'));
		}
	}

	/** One-click queue assign: tech + slot into the filtered day (or today) after their last job. */
	function qualifiedFor(t: { skillTags: string }, jobTypeId: string | null) {
		return !jobTypeId || !t.skillTags || t.skillTags.split(',').includes(jobTypeId);
	}
	function warnIfUnqualified(jobTypeId: string | null, techId: string | null) {
		if (!techId) return;
		const t = board.technicians.find((x) => x.id === techId);
		if (t && !qualifiedFor(t, jobTypeId))
			toast.warning(`Heads-up: ${t.name} isn't tagged for this job type`);
	}

	/** Best-fit tech for a queue job on the target day: qualified (skill tags) with the lightest load. */
	function suggestTech(j: (typeof filteredQueue)[number], day: string) {
		const qualified = board.technicians.filter((t) => qualifiedFor(t, j.job.jobTypeId));
		if (!qualified.length) return null;
		const load = (id: string) =>
			board.scheduled
				.filter(
					(x) =>
						x.job.technicianId === id &&
						x.job.startsAt &&
						x.job.endsAt &&
						localDate(new Date(x.job.startsAt), tz) === day
				)
				.reduce((m, x) => m + (+new Date(x.job.endsAt!) - +new Date(x.job.startsAt!)) / 60000, 0);
		return qualified.sort((a, b) => load(a.id) - load(b.id))[0].id;
	}

	const prioOrder = ['low', 'normal', 'high', 'urgent'] as const;
	async function bumpPriority(j: (typeof filteredQueue)[number]) {
		const i = prioOrder.indexOf(j.job.priority as (typeof prioOrder)[number]);
		if (i < 0 || i >= prioOrder.length - 1) return;
		const next = prioOrder[i + 1];
		try {
			await updateJob({ id: j.job.id, priority: next }).updates(getDispatchBoard);
			toast.success(`J-${j.job.number} → ${next}`);
		} catch (err) {
			toast.error(errMsg(err, 'Could not update priority'));
		}
	}

	async function quickAssign(j: (typeof filteredQueue)[number], techId: string) {
		if (!techId) return;
		try {
			const day = dayFilter || todayStr;
			if (techId === '__auto__') {
				const pick = suggestTech(j, day);
				if (!pick) {
					toast.error('No qualified tech on this board');
					return;
				}
				techId = pick;
			}
			const toInput = (d: Date | string) => `${localDate(new Date(d), tz)}T${localTime(d, tz)}`;
			const group = byTech.find(([id]) => id === techId)?.[1];
			const last = (group?.jobs ?? [])
				.filter(
					(x) => x.job.startsAt && x.job.endsAt && localDate(new Date(x.job.startsAt), tz) === day
				)
				.map((x) => x.job.endsAt as Date)
				.sort((a, b) => a.getTime() - b.getTime())
				.at(-1);
			const when = last ? toInput(last) : `${day}T08:00`;
			await updateJob({ id: j.job.id, technicianId: techId, startsAt: when }).updates(
				getDispatchBoard
			);
			toast.success('Assigned');
			warnIfUnqualified(j.job.jobTypeId, techId);
		} catch (err) {
			toast.error(errMsg(err, 'Could not assign'));
		}
	}

	let reorderPending = $state(false);
	async function moveStop(
		techId: string,
		j: (typeof board.scheduled)[number],
		direction: 'up' | 'down'
	) {
		if (!dayFilter) return;
		reorderPending = true;
		try {
			await moveDayStop({
				memberId: techId,
				on: dayFilter,
				jobId: j.job.id,
				direction
			}).updates(getDispatchBoard);
		} catch (err) {
			toast.error(errMsg(err, 'Could not move stop'));
		}
		reorderPending = false;
	}

	const byTech = $derived.by(() => {
		const map = new SvelteMap<string, { name: string; jobs: typeof board.scheduled }>();
		for (const t of board.technicians) map.set(t.id, { name: t.name, jobs: [] });
		map.set('', { name: 'Unassigned', jobs: [] });
		for (const j of board.scheduled) {
			const key = j.job.technicianId ?? '';
			if (!map.has(key)) map.set(key, { name: j.technicianName ?? 'Unassigned', jobs: [] });
			map.get(key)!.jobs.push(j);
		}
		return [...map.entries()].filter(([, v]) => v.jobs.length || v.name !== 'Unassigned');
	});
</script>

<PageHeader title="Dispatch board">
	{#snippet actions()}
		<div class="flex items-center gap-1">
			{#if offices.length > 1}
				<Select.Root
					type="single"
					value={officeId}
					onValueChange={(v) => {
						officeId = v === 'all' ? '' : v;
						goto(`?from=${start}${officeId ? `&office=${officeId}` : ''}`, {
							replaceState: true
						});
					}}
				>
					<Select.Trigger class="h-8 w-40">{officeName || 'All offices'}</Select.Trigger>
					<Select.Content>
						<Select.Item value="all">All offices</Select.Item>
						{#each offices as o (o.id)}
							<Select.Item value={o.id}>{o.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			{/if}
			<Select.Root type="single" value={dayFilter} onValueChange={(v) => (dayFilter = v)}>
				<Select.Trigger class="h-8 w-32"
					>{dayFilter
						? new Date(`${dayFilter}T12:00:00Z`).toLocaleDateString('en-US', {
								weekday: 'short',
								month: 'numeric',
								day: 'numeric',
								timeZone: 'UTC'
							})
						: 'All days'}</Select.Trigger
				>
				<Select.Content>
					<Select.Item value="">All days</Select.Item>
					{#each weekDays as d (d)}
						<Select.Item value={d}
							>{new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', {
								weekday: 'short',
								month: 'numeric',
								day: 'numeric',
								timeZone: 'UTC'
							})}{d === todayStr ? ' · today' : ''}</Select.Item
						>
					{/each}
				</Select.Content>
			</Select.Root>
			{#if peakDay}
				<Badge class="hidden md:inline-flex" variant="outline"
					>peak {new Date(`${peakDay[0]}T12:00:00Z`).toLocaleDateString('en-US', {
						weekday: 'short',
						timeZone: 'UTC'
					})} ({peakDay[1]})</Badge
				>
			{/if}
			{#if weekCount}
				<Badge class="hidden md:inline-flex" variant="outline">{weekCount} this week</Badge>
			{/if}
			{#if bookedOnline}
				<Badge variant="outline" class="hidden text-muted-foreground md:inline-flex"
					>{bookedOnline} booked online</Badge
				>
			{/if}
			{#if doneThisWeek}
				<Badge class="hidden md:inline-flex" variant="outline">{doneThisWeek} done</Badge>
			{/if}
			{#if onSiteNow}
				<Badge variant="outline" class="text-green-600 dark:text-green-400"
					>{onSiteNow} on site now</Badge
				>
			{/if}
			{#if techsOn}
				<Badge variant="outline" class="hidden text-muted-foreground md:inline-flex"
					>{techsOn} tech{techsOn === 1 ? '' : 's'} on today</Badge
				>
			{/if}
			{#if schedTodayMin > 0}
				<Badge class="hidden md:inline-flex" variant="outline"
					>{Math.floor(schedTodayMin / 60)}h {Math.round(schedTodayMin % 60)}m sched today</Badge
				>
			{/if}
			{#if avgPerTechToday}
				<Badge class="hidden md:inline-flex" variant="outline"
					>avg {avgPerTechToday.toFixed(1)} jobs/tech today</Badge
				>
			{/if}
			{#if unassignedToday}
				<Badge variant="outline" class="hidden text-amber-600 md:inline-flex dark:text-amber-400"
					>{unassignedToday} unassigned today</Badge
				>
			{/if}
			{#if offThisWeek}
				<Badge class="hidden md:inline-flex" variant="outline">{offThisWeek} off this week</Badge>
			{/if}
			{#if offToday}
				<Badge variant="outline" class="hidden text-amber-600 md:inline-flex dark:text-amber-400"
					>{offToday} off today</Badge
				>
			{/if}
			<Button variant="outline" size="icon" class="size-8" onclick={() => shift(-7)}
				><ChevronLeft /></Button
			>
			<Button
				variant="ghost"
				size="sm"
				onclick={() => goto(`?from=${todayStr}`, { replaceState: true })}>Today</Button
			>
			<Button variant="outline" size="icon" class="size-8" onclick={() => shift(7)}
				><ChevronRight /></Button
			>
			<Button
				variant="outline"
				size="sm"
				onclick={textEtas}
				disabled={etaPending}
				title="Text every customer with a job that day their ETA"
				><MessageSquare /> {etaPending ? 'Texting…' : 'Text ETAs'}</Button
			>
			<Button
				variant="outline"
				size="sm"
				onclick={copyThisWeek}
				disabled={copyPending}
				title="Duplicate this week's jobs onto the same weekdays next week"
				><CalendarPlus /> {copyPending ? 'Copying…' : 'Copy week'}</Button
			>
			{#if ai.available}
				<Button
					variant="outline"
					size="sm"
					title="Suggest tech assignments for {dayFilter || todayStr}"
					disabled={suggestPending}
					onclick={aiSuggest}><Sparkles /> {suggestPending ? 'Thinking…' : 'AI suggest'}</Button
				>
			{/if}
			<Button
				variant="outline"
				size="icon"
				class="size-8"
				title="Print this week's schedule"
				href="/dispatch/print?from={start}"
				target="_blank"><Printer /></Button
			>
			<Button
				variant="outline"
				size="sm"
				title="Printable route sheet per tech for {dayFilter || todayStr}"
				href="/dispatch/routesheets?day={dayFilter || todayStr}"
				target="_blank">Sheets</Button
			>
		</div>
	{/snippet}
</PageHeader>

<div class="grid grid-cols-1 gap-4 p-4 md:p-6 lg:grid-cols-[300px_1fr]">
	{#snippet queueRow(j: (typeof filteredQueue)[number])}
		<div class="flex items-start gap-2">
			<Checkbox
				class="mt-2"
				checked={selected.has(j.job.id)}
				onCheckedChange={() => toggleSelect(j.job.id)}
			/>
			<button
				class="w-full cursor-grab rounded-lg border p-3 text-left transition-colors hover:bg-accent {selected.has(
					j.job.id
				)
					? 'border-primary bg-primary/5'
					: ''}"
				draggable="true"
				ondragstart={(e) => dragJob(e, j)}
				ondragover={allowDrop}
				ondrop={(e) => {
					e.stopPropagation();
					dropOn(e, 'queue');
				}}
				onclick={() => goto(`/jobs/${j.job.id}`)}
			>
				<div class="flex items-center justify-between gap-2">
					<span class="truncate text-sm font-medium">
						{j.job.summary || j.jobTypeName} · {j.customerName}
					</span>
					<StatusBadge status={j.job.priority} />
				</div>
				<p class="mt-1 text-xs text-muted-foreground">
					J-{j.job.number} · {j.job.source} ·
					<span
						class={waitingDays(j.job.createdAt) >= 3
							? 'font-medium text-amber-600 dark:text-amber-400'
							: ''}>waiting {waitingDays(j.job.createdAt)}d</span
					>
					{#if j.job.blocked}· <span class="text-amber-600 dark:text-amber-400">parts</span>{/if}
					{#if j.depOpen}· <span class="text-amber-600 dark:text-amber-400"
							>dep J-{j.depNumber}</span
						>{/if}
					{#if j.job.source === 'booking' && waitingDays(j.job.createdAt) === 0}· <span
							class="text-blue-600 dark:text-blue-400">new request</span
						>{/if}
					{#if j.job.needsReview}· <span class="font-medium text-amber-600 dark:text-amber-400"
							>needs review</span
						>{/if}
					{#if !j.customerPhone}· <span class="text-red-500">no phone</span>{/if}
					{#if j.city}· {j.city}{/if}
					{#if j.job.preferredTime}
						{#if j.job.preferredTime.startsWith('Reschedule requested:')}
							<br /><span class="font-medium text-orange-600 dark:text-orange-400"
								>reschedule asked: {j.job.preferredTime
									.slice('Reschedule requested:'.length)
									.trim()}</span
							>
						{:else}
							<br /><span class="text-amber-600 dark:text-amber-400"
								>Asked: {j.job.preferredTime}</span
							>
						{/if}
					{/if}
				</p>
			</button>
			<div class="mt-1.5 flex shrink-0 items-center gap-1">
				<Button
					size="icon"
					variant="ghost"
					class="size-7"
					title="Bump priority ({j.job.priority} → higher)"
					disabled={j.job.priority === 'urgent'}
					onclick={() => bumpPriority(j)}><ChevronsUp /></Button
				>
				<Select.Root type="single" onValueChange={(v) => quickAssign(j, v)}>
					<Select.Trigger
						class="h-7 w-[4.5rem] shrink-0 px-1.5 text-xs"
						title="Assign to a tech on {dayFilter || todayStr}">Assign</Select.Trigger
					>
					<Select.Content>
						<Select.Item value="__auto__">Auto (best fit)</Select.Item>
						{#each board.technicians as t (t.id)}
							<Select.Item value={t.id}
								>{t.name}{#if !qualifiedFor(t, j.job.jobTypeId)}
									<span class="text-amber-600"> · not tagged</span>{/if}</Select.Item
							>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
			{#if j.job.needsReview}
				<div class="mt-1.5 flex shrink-0 flex-col gap-1">
					<Button
						size="sm"
						variant="outline"
						class="h-7 px-2 text-xs"
						disabled={reviewBusy === j.job.id}
						onclick={() => review(j.job.id, true)}>Accept</Button
					>
					<Button
						size="sm"
						variant="ghost"
						class="h-7 px-2 text-xs text-destructive"
						disabled={reviewBusy === j.job.id}
						onclick={() => review(j.job.id, false)}>Decline</Button
					>
				</div>
			{/if}
		</div>
	{/snippet}
	<!-- Unscheduled queue -->
	<Card.Root
		class="h-fit {dropZone === 'queue' ? 'ring-2 ring-primary' : ''}"
		ondragover={allowDrop}
		ondragenter={() => (dropZone = 'queue')}
		ondragleave={() => (dropZone = null)}
		ondrop={(e) => dropOn(e, 'queue')}
	>
		<Card.Header class="flex-row flex-wrap items-center gap-2">
			<Inbox class="size-4 text-muted-foreground" />
			<Card.Title class="min-w-0 truncate text-base"
				>Unscheduled ({board.unscheduled.length})</Card.Title
			>
			{#if queueRequests.length}
				<Badge variant="outline" class="text-blue-600 dark:text-blue-400"
					>{queueRequests.length} request{queueRequests.length === 1 ? '' : 's'}</Badge
				>
			{/if}
			{@const urgentCount = board.unscheduled.filter(
				(j) => j.job.priority === 'urgent' || j.job.priority === 'high'
			).length}
			{#if urgentCount}
				<Badge variant="outline" class="text-amber-600 dark:text-amber-400"
					>{urgentCount} urgent/high</Badge
				>
			{/if}
			{#if board.unscheduled.length}
				{@const oldestWait = Math.max(
					...board.unscheduled.map((j) => waitingDays(j.job.createdAt))
				)}
				{#if oldestWait > 0}
					<Badge
						variant="outline"
						class={oldestWait >= 3 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}
						>oldest {oldestWait}d</Badge
					>
				{/if}
			{/if}
			<div class="ml-auto flex items-center gap-1.5">
				<Select.Root
					type="single"
					value={queueSort}
					onValueChange={(v) => (queueSort = v as 'priority' | 'oldest')}
				>
					<Select.Trigger class="h-7 w-28 px-2 text-xs" title="Queue order"
						>{queueSort === 'oldest' ? 'Oldest first' : 'Priority'}</Select.Trigger
					>
					<Select.Content>
						<Select.Item value="priority">Priority</Select.Item>
						<Select.Item value="oldest">Oldest first</Select.Item>
					</Select.Content>
				</Select.Root>
				<Input class="h-7 w-32 text-xs" placeholder="Filter…" bind:value={queueFilter} />
			</div>
		</Card.Header>
		{#if selected.size}
			<div class="flex items-center gap-2 border-b px-4 py-2">
				<span class="text-xs text-muted-foreground">{selected.size} selected</span>
				<Select.Root type="single" bind:value={bulkTech}>
					<Select.Trigger class="h-7 w-32 text-xs"
						>{board.technicians.find((t) => t.id === bulkTech)?.name ||
							'Technician'}</Select.Trigger
					>
					<Select.Content>
						{#each board.technicians as t (t.id)}
							<Select.Item value={t.id}>{t.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				<Button
					size="sm"
					class="h-7 text-xs"
					disabled={bulkBusy || !bulkTech}
					onclick={assignSelected}>Assign</Button
				>
				<Button size="sm" variant="ghost" class="h-7 text-xs" onclick={() => selected.clear()}
					>Clear</Button
				>
			</div>
		{/if}
		<Card.Content class="space-y-2 px-4">
			{#if queueRequests.length}
				<p class="pt-1 text-xs font-medium text-blue-600 dark:text-blue-400">
					Requests — waiting on a first schedule
				</p>
				{#each queueRequests as j (j.job.id)}
					{@render queueRow(j)}
				{/each}
			{/if}
			{#if queueOthers.length}
				{#if queueRequests.length}
					<p class="pt-2 text-xs font-medium text-muted-foreground">Backlog</p>
				{/if}
				{#each queueOthers as j (j.job.id)}
					{@render queueRow(j)}
				{/each}
			{/if}
			{#if !filteredQueue.length}
				<Empty.Root class="border-0 py-4">
					<Empty.Header>
						<Empty.Media><Inbox /></Empty.Media>
						<Empty.Title class="text-sm">Queue is clear</Empty.Title>
						<Empty.Description>Nothing waiting to be scheduled.</Empty.Description>
					</Empty.Header>
				</Empty.Root>
			{/if}
		</Card.Content>
	</Card.Root>

	<!-- Scheduled, grouped by technician -->
	<div class="min-w-0 space-y-4">
		<!-- Booking waitlist -->
		{#if board.waitlist?.length}
			<Card.Root>
				<Card.Header>
					<Card.Title class="text-base">Waitlist ({board.waitlist.length})</Card.Title>
					<Card.Description
						>Asked for a call back from the booking page — reach out and book them in.</Card.Description
					>
				</Card.Header>
				<Card.Content class="overflow-x-auto px-0">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head class="pl-6">Name</Table.Head>
								<Table.Head>Contact</Table.Head>
								<Table.Head>Service</Table.Head>
								<Table.Head>Note</Table.Head>
								<Table.Head>Asked</Table.Head>
								<Table.Head class="pr-6 text-right">Status</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each board.waitlist as w (w.id)}
								<Table.Row>
									<Table.Cell class="pl-6 font-medium">{w.name}</Table.Cell>
									<Table.Cell class="text-sm">
										{#if w.phone}
											<a class="hover:underline" href="tel:{w.phone}">{w.phone}</a>
										{/if}
										{#if w.phone && w.email}·{/if}
										{#if w.email}
											<a class="hover:underline" href="mailto:{w.email}">{w.email}</a>
										{/if}
									</Table.Cell>
									<Table.Cell class="text-sm">{w.jobTypeName ?? '—'}</Table.Cell>
									<Table.Cell class="max-w-48 truncate text-sm text-muted-foreground"
										>{w.note || '—'}</Table.Cell
									>
									<Table.Cell
										class="text-sm whitespace-nowrap {waitingDays(w.createdAt) >= 2
											? 'font-medium text-amber-600 dark:text-amber-400'
											: 'text-muted-foreground'}">{formatRelative(w.createdAt)}</Table.Cell
									>
									<Table.Cell class="pr-6">
										<div class="flex justify-end gap-1.5">
											{#if w.status === 'new'}
												<Button
													size="sm"
													variant="outline"
													disabled={waitlistBusy === w.id}
													onclick={() => setWaitlist(w.id, 'contacted')}>Contacted</Button
												>
											{/if}
											<Button
												size="sm"
												disabled={waitlistBusy === w.id}
												title="Create a customer + unscheduled job for them"
												onclick={() => bookWaitlist(w.id)}>Book</Button
											>
											<Button
												size="sm"
												variant="ghost"
												disabled={waitlistBusy === w.id}
												onclick={() => setWaitlist(w.id, 'closed')}>Close</Button
											>
										</div>
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</Card.Content>
			</Card.Root>
		{/if}

		{#each byTech as [techId, group] (techId || 'unassigned')}
			{@const techSkills = board.technicians.find((t) => t.id === techId)?.skillTags ?? ''}
			<Card.Root
				class={dropZone === (techId || 'unassigned') ? 'ring-2 ring-primary' : ''}
				ondragover={allowDrop}
				ondragenter={() => (dropZone = techId || 'unassigned')}
				ondragleave={() => (dropZone = null)}
				ondrop={(e) => dropOn(e, techId)}
			>
				<Card.Header>
					<Card.Title class="flex items-center gap-2 text-base">
						{@const techColor = board.technicians.find((t) => t.id === techId)?.color ?? ''}
						{#if techColor}
							<span class="inline-block size-2.5 shrink-0 rounded-full" style:background={techColor}
							></span>
						{/if}
						{group.name}
						{#if techId}
							{@const hasNote = board.dayNotes.some(
								(n) => n.memberId === techId && n.on === (dayFilter || todayStr)
							)}
							<button
								class="inline-flex size-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-accent {hasNote
									? 'text-amber-600 dark:text-amber-400'
									: 'text-muted-foreground/50'}"
								title="Day note for {group.name} on {dayFilter || todayStr}"
								onclick={() => openDayNote(techId, group.name)}
							>
								<StickyNote class="size-3.5" />
							</button>
						{/if}
						{#if techId && board.lastPing?.[techId]}
							{@const ping = board.lastPing[techId]}
							<a
								class="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-accent"
								title="Last GPS ping {formatRelative(ping.at)} — open map"
								href="https://www.google.com/maps?q={ping.lat},{ping.lng}"
								target="_blank"
								rel="noopener noreferrer"
								onclick={(e) => e.stopPropagation()}
							>
								<MapPin class="size-3.5" />
							</a>
						{/if}
						{#if group.jobs.length}
							<Badge variant="outline" class="font-normal text-muted-foreground"
								>{group.jobs.length} job{group.jobs.length === 1 ? '' : 's'} ·
								{(
									group.jobs.reduce(
										(m, j) =>
											m +
											(j.job.startsAt && j.job.endsAt
												? (new Date(j.job.endsAt).getTime() - new Date(j.job.startsAt).getTime()) /
													60_000
												: 0),
										0
									) / 60
								).toFixed(1)}h</Badge
							>
						{/if}
						{#each board.timeOff.filter((t) => t.memberId === techId) as t (t.id)}
							<Badge variant="secondary" class="font-normal text-amber-700 dark:text-amber-400">
								Off {t.startsOn}{t.endsOn !== t.startsOn ? ` – ${t.endsOn}` : ''}
							</Badge>
						{/each}
					</Card.Title>
				</Card.Header>
				<Card.Content class="px-4">
					{#if dayJobs(group.jobs).length === 0}
						<p class="py-2 text-sm text-muted-foreground">
							{dayFilter ? 'No jobs on this day.' : 'No jobs scheduled this week.'}
						</p>
					{:else}
						<ul class="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
							{#each dayJobs(group.jobs) as j, i (j.job.id)}
								<li class="flex items-stretch gap-1">
									<button
										class="w-full cursor-grab rounded-lg border p-3 text-left transition-colors hover:bg-accent"
										draggable="true"
										ondragstart={(e) => dragJob(e, j)}
										ondragover={allowDrop}
										ondrop={(e) => {
											e.stopPropagation();
											dropOn(e, techId, j.job.id);
										}}
										onclick={() => goto(`/jobs/${j.job.id}`)}
									>
										<div class="flex items-center gap-2">
											<span
												class="inline-block size-2 shrink-0 rounded-full"
												style:background={j.color}
											></span>
											<span class="truncate text-sm font-medium"
												>{j.job.summary || j.jobTypeName}</span
											>
											{#if techSkills && j.job.jobTypeId && !techSkills
													.split(',')
													.includes(j.job.jobTypeId)}
												<Badge
													variant="outline"
													class="shrink-0 text-amber-600 dark:text-amber-400"
													title="Tech isn't tagged for this job type">unqualified</Badge
												>
											{/if}
											<StatusBadge status={j.job.status} class="ml-auto" />
										</div>
										<p class="mt-1 text-xs text-muted-foreground">
											{#if dayFilter && techId}{i + 1}.&nbsp;{/if}J-{j.job.number} ·
											{j.customerName} ·
											{j.job.startsAt
												? `${localDate(j.job.startsAt, tz)} ${localTime(j.job.startsAt, tz)}`
												: 'unscheduled'}
											{#if j.job.endsAt && j.job.startsAt && localDate(j.job.endsAt, tz) !== localDate(j.job.startsAt, tz)}
												→ {localDate(j.job.endsAt, tz)}
											{/if}
											{#if j.job.blocked}
												· <span class="text-amber-600 dark:text-amber-400">parts</span>
											{/if}
											{#if j.job.warranty}
												· <span>warranty</span>
											{/if}
											{#if j.depOpen}
												· <span class="text-amber-600 dark:text-amber-400">dep J-{j.depNumber}</span
												>
											{/if}
											{#if j.typeRequiresHelper && !j.job.helperId}
												<span class="text-amber-600 dark:text-amber-400">· needs 2 techs</span>
											{/if}
											{#if j.job.helperId}
												· <span title="Second tech on the job"
													>+{board.technicians.find((t) => t.id === j.job.helperId)?.name ??
														'helper'}</span
												>
											{/if}
											{#if j.job.preferredTime?.startsWith('Reschedule requested:')}
												· <span
													class="font-medium text-orange-600 dark:text-orange-400"
													title="Customer asked to reschedule — move the visit to clear"
													>reschedule: {j.job.preferredTime
														.slice('Reschedule requested:'.length)
														.trim()}</span
												>
											{/if}
										</p>
									</button>
									{#if dayFilter && techId && dayJobs(group.jobs).length > 1}
										<div class="flex shrink-0 flex-col justify-center gap-0.5">
											<Button
												variant="ghost"
												size="icon"
												class="size-6"
												disabled={i === 0 || reorderPending}
												aria-label="Move stop earlier"
												title="Move stop earlier"
												onclick={() => moveStop(techId, j, 'up')}
											>
												<ChevronUp class="size-3.5" />
											</Button>
											<Button
												variant="ghost"
												size="icon"
												class="size-6"
												disabled={i === dayJobs(group.jobs).length - 1 || reorderPending}
												aria-label="Move stop later"
												title="Move stop later"
												onclick={() => moveStop(techId, j, 'down')}
											>
												<ChevronDown class="size-3.5" />
											</Button>
										</div>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</Card.Content>
			</Card.Root>
		{/each}
	</div>
</div>

<!-- per-tech day note -->
<Dialog.Root bind:open={noteOpen}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Day note — {noteName}</Dialog.Title>
			<Dialog.Description>Shown as a banner on their My Day.</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-3" onsubmit={saveDayNote}>
			<Input
				type="date"
				value={noteOn}
				required
				onchange={(e) => {
					noteOn = e.currentTarget.value;
					noteText =
						board.dayNotes.find((n) => n.memberId === noteMemberId && n.on === noteOn)?.note ?? '';
				}}
			/>
			<Input placeholder="Note for {noteOn}…" maxlength={200} bind:value={noteText} />
			<div class="flex justify-end gap-2">
				{#if noteText || board.dayNotes.some((n) => n.memberId === noteMemberId && n.on === noteOn)}
					<Button
						type="button"
						size="sm"
						variant="ghost"
						onclick={() => {
							noteText = '';
						}}>Clear</Button
					>
				{/if}
				<Button type="submit" size="sm" disabled={notePending}
					>{notePending ? 'Saving…' : 'Save'}</Button
				>
			</div>
		</form>
	</Dialog.Content>
</Dialog.Root>

<!-- AI dispatch suggestions -->
<Dialog.Root bind:open={suggestOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>AI assignment suggestions — {dayFilter || todayStr}</Dialog.Title>
			<Dialog.Description>
				One pick per queued job — apply row by row, or close to keep the board as-is.
			</Dialog.Description>
		</Dialog.Header>
		{#if suggestions.length}
			<div class="divide-y">
				{#each suggestions as s (s.jobId)}
					{@const job = board.unscheduled.find((r) => r.job.id === s.jobId)}
					{@const tech = board.technicians.find((t) => t.id === s.memberId)}
					<div class="flex items-center gap-2 py-2 text-sm">
						<span class="font-medium whitespace-nowrap"
							>J-{job?.job.number ?? '?'} {job?.job.summary || job?.jobTypeName}</span
						>
						<span class="text-muted-foreground">→ {tech?.name ?? '?'}</span>
						<span class="flex-1 truncate text-xs text-muted-foreground" title={s.reason}
							>{s.reason}</span
						>
						<Button size="sm" variant="outline" onclick={() => applySuggestion(s.jobId, s.memberId)}
							>Assign</Button
						>
					</div>
				{/each}
			</div>
		{:else}
			<p class="py-4 text-center text-sm text-muted-foreground">
				No suggestions — the queue is empty or nothing matched a tech's day.
			</p>
		{/if}
	</Dialog.Content>
</Dialog.Root>
