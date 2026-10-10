<script lang="ts">
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import {
		getDayAvailability,
		joinBookingWaitlist,
		requestBookingForm
	} from '#lib/remote/public.remote.ts';
	import Logo from '#lib/components/app/logo.svelte';
	import { errMsg, formatMoney } from '#lib/format.ts';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Phone from '@lucide/svelte/icons/phone';
	import Globe from '@lucide/svelte/icons/globe';
	import Clock from '@lucide/svelte/icons/clock';
	import CalendarPlus from '@lucide/svelte/icons/calendar-plus';
	import { page } from '$app/state';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const { org, settings, plans, jobTypes, techs } = $derived(data);
	const currency = $derived(settings?.currency ?? 'usd');

	let name = $state('');
	let email = $state('');
	let phone = $state('');
	// Deep link: /book/<slug>?type=<jobTypeId> preselects the service
	// (e.g. a per-service "Book now" button on the org's own site).
	const typeParam = page.url.searchParams.get('type') ?? '';
	onMount(() => {
		if (page.url.searchParams.get('paid') === '1') {
			toast.success('Deposit received — your request is confirmed.');
			done = true;
		}
	});
	let jobTypeId = $state(data.jobTypes.some((t) => t.id === typeParam) ? typeParam : '');
	let preferredMemberId = $state('any');
	let address1 = $state('');
	let city = $state('');
	let addrState = $state('');
	let zip = $state('');
	let preferredDate = $state('');
	let preferredTime = $state('');
	const noticeDays = $derived(settings?.bookingNoticeDays ?? 0);
	const minDate = $derived(
		new Date(Date.now() + noticeDays * 86400_000).toISOString().slice(0, 10)
	);
	const maxDays = $derived(settings?.bookingMaxDaysAhead ?? 0);
	const maxDate = $derived(
		maxDays > 0 ? new Date(Date.now() + maxDays * 86400_000).toISOString().slice(0, 10) : undefined
	);

	const closedDays = $derived(
		new Set(
			(settings?.bookingBlackouts ?? '')
				.split(',')
				.map((d) => d.trim())
				.filter(Boolean)
		)
	);
	const dayClosed = $derived(!!preferredDate && closedDays.has(preferredDate));
	const dailyLimit = $derived(settings?.bookingDailyLimit ?? 0);
	const dayAvail = $derived(
		preferredDate && dailyLimit > 0
			? await getDayAvailability({ slug: org.slug, date: preferredDate })
			: null
	);
	const dayFull = $derived(dayAvail?.limited === true && dayAvail.remaining === 0);
	let description = $state('');
	let leadSource = $state('');
	let website = $state(''); // honeypot — must stay empty
	let pending = $state(false);
	let done = $state(false);
	let reference = $state('');

	// All-day .ics placeholder for the requested date — booking is a request,
	// not a confirmed slot, so the event records the preference, not an ETA.
	const icsHref = $derived.by(() => {
		if (!done || !preferredDate) return '';
		const stamp = (d: string) => d.replaceAll('-', '');
		const start = new Date(`${preferredDate}T00:00:00`);
		const end = new Date(start.getTime() + 86400_000)
			.toISOString()
			.slice(0, 10)
			.replaceAll('-', '');
		const lines = [
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'PRODID:-//Tredaro//Booking//EN',
			'BEGIN:VEVENT',
			`UID:${reference || start.getTime()}@tredaro`,
			`DTSTAMP:${new Date().toISOString().replace(/[-:]|\.\d{3}/g, '')}`,
			`DTSTART;VALUE=DATE:${stamp(preferredDate)}`,
			`DTEND;VALUE=DATE:${end}`,
			`SUMMARY:${org.name} service visit${reference ? ` (${reference})` : ''}`,
			`DESCRIPTION:Service requested with ${org.name}.${preferredTime ? ` Preferred time: ${preferredTime}.` : ''} We will confirm a time with you.`,
			'END:VEVENT',
			'END:VCALENDAR'
		];
		return `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join('\r\n'))}`;
	});

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			const r = await requestBookingForm({
				slug: org.slug,
				input: {
					name,
					email,
					phone,
					jobTypeId: jobTypeId || undefined,
					address1,
					city,
					state: addrState,
					zip,
					preferredTime: preferredDate
						? `${preferredDate}${preferredTime ? ` · ${preferredTime}` : ''}`
						: preferredTime,
					description,
					leadSource,
					preferredMemberId: preferredMemberId !== 'any' ? preferredMemberId : undefined,
					website
				}
			});
			reference = r.job?.number ? `J-${r.job.number}` : '';
			if (r.payUrl) {
				location.assign(r.payUrl);
				return;
			}
			done = true;
		} catch (err) {
			toast.error(errMsg(err, 'Could not submit — try again'));
		}
		pending = false;
	}

	// ------- waitlist -------
	let wlName = $state('');
	let wlContact = $state('');
	let wlJobTypeId = $state('');
	let wlNote = $state('');
	let wlPending = $state(false);
	let waitlistDone = $state(false);

	async function joinList(e: SubmitEvent) {
		e.preventDefault();
		wlPending = true;
		try {
			const contact = wlContact.trim();
			await joinBookingWaitlist({
				slug: org.slug,
				name: wlName,
				email: contact.includes('@') ? contact : '',
				phone: contact.includes('@') ? '' : contact,
				jobTypeId: wlJobTypeId || '',
				note: wlNote
			});
			waitlistDone = true;
			toast.success("You're on the waitlist");
		} catch (err) {
			toast.error(errMsg(err, 'Could not join — try again'));
		}
		wlPending = false;
	}
</script>

<svelte:head>
	<title>Book service — {org.name}</title>
	<meta
		name="description"
		content={settings?.tagline || `Request service from ${org.name} online.`}
	/>
</svelte:head>

<div class="min-h-svh bg-background">
	<header class="border-b">
		<div class="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
			<Logo />
			<span class="truncate font-semibold">{org.name}</span>
			{#if settings?.address}
				<span class="ml-auto hidden items-center gap-1 text-sm text-muted-foreground sm:flex"
					><MapPin class="size-3.5" /> {settings.address}</span
				>
			{/if}
		</div>
	</header>

	<main class="mx-auto max-w-3xl space-y-8 p-4 py-8">
		<div class="space-y-2">
			<h1 class="text-3xl font-semibold tracking-tight">{org.name}</h1>
			{#if settings?.tagline}<p class="text-lg text-muted-foreground">{settings.tagline}</p>{/if}
			<div class="flex flex-wrap gap-3 text-sm text-muted-foreground">
				{#if settings?.address}<span class="flex items-center gap-1"
						><MapPin class="size-3.5" />{settings.address}</span
					>{/if}
				{#if settings?.phone}<span class="flex items-center gap-1"
						><Phone class="size-3.5" />{settings.phone}</span
					>{/if}
				{#if settings?.businessHours}<span class="flex items-center gap-1"
						><Clock class="size-3.5" />{settings.businessHours}</span
					>{/if}
				{#if settings?.website}<a
						class="flex items-center gap-1 underline-offset-4 hover:underline"
						href={settings.website.startsWith('http')
							? settings.website
							: `https://${settings.website}`}><Globe class="size-3.5" />Website</a
					>{/if}
			</div>
		</div>

		{#if plans.length}
			<section class="space-y-3">
				<h2 class="text-lg font-semibold">Service agreements</h2>
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
					{#each plans as p (p.id)}
						<Card.Root>
							<Card.Header>
								<Card.Title class="text-base">{p.name}</Card.Title>
								{#if p.description}<Card.Description>{p.description}</Card.Description>{/if}
							</Card.Header>
							<Card.Content class="px-6">
								<p class="text-2xl font-semibold tabular-nums">
									{formatMoney(p.amount, currency)}<span
										class="text-sm font-normal text-muted-foreground">/{p.interval}</span
									>
								</p>
								<p class="mt-1 text-sm text-muted-foreground">
									Ask about it when we call to schedule.
								</p>
							</Card.Content>
						</Card.Root>
					{/each}
				</div>
			</section>
		{/if}

		<section class="space-y-3">
			<h2 class="text-lg font-semibold">Request service</h2>
			{#if done}
				<Card.Root>
					<Card.Content class="py-10 text-center">
						<p class="text-lg font-semibold">Request received</p>
						{#if reference}
							<p class="mt-1 text-sm font-medium">Reference {reference}</p>
						{/if}
						<p class="mt-1 text-sm text-muted-foreground">
							{settings?.bookingMessage || `${org.name} will call or email you to confirm a time.`}
						</p>
						{#if icsHref}
							<Button
								variant="outline"
								size="sm"
								class="mt-3"
								href={icsHref}
								download="tredaro-booking.ics"><CalendarPlus /> Add to calendar</Button
							>
						{/if}
					</Card.Content>
				</Card.Root>
			{:else if settings && !settings.bookingEnabled}
				<Card.Root>
					<Card.Content class="py-10 text-center">
						<p class="text-lg font-semibold">Online booking is closed</p>
						<p class="mt-1 text-sm text-muted-foreground">
							{#if settings.phone}Call or text {settings.phone} to schedule.{:else}Contact {org.name}
								to schedule.{/if}
						</p>
					</Card.Content>
				</Card.Root>
			{:else}
				<Card.Root>
					<Card.Content class="px-6 py-6">
						<form class="space-y-4" onsubmit={submit}>
							<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
								<Field.Field>
									<Field.Label for="b-name">Name</Field.Label>
									<Input id="b-name" required bind:value={name} autocomplete="name" />
								</Field.Field>
								<Field.Field>
									<Field.Label for="b-email">Email</Field.Label>
									<Input
										id="b-email"
										type="email"
										required
										bind:value={email}
										autocomplete="email"
									/>
								</Field.Field>
							</div>
							<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
								<Field.Field>
									<Field.Label for="b-phone">Phone</Field.Label>
									<Input id="b-phone" required bind:value={phone} autocomplete="tel" />
								</Field.Field>
								{#if jobTypes.length}
									<Field.Field>
										<Field.Label>What do you need?</Field.Label>
										<Select.Root type="single" bind:value={jobTypeId}>
											<Select.Trigger class="w-full">
												{jobTypes.find((t) => t.id === jobTypeId)?.name ?? 'Pick a service'}
											</Select.Trigger>
											<Select.Content>
												{#each jobTypes as t (t.id)}
													<Select.Item value={t.id}>
														<span class="flex flex-col">
															<span>
																{t.name}{t.defaultAmount
																	? ` — ${formatMoney(t.defaultAmount, currency)}`
																	: ''}
															</span>
															{#if t.description}
																<span class="text-xs text-muted-foreground">{t.description}</span>
															{/if}
														</span>
													</Select.Item>
												{/each}
											</Select.Content>
										</Select.Root>
									</Field.Field>
								{/if}
								{#if techs.length}
									<Field.Field>
										<Field.Label>Preferred technician (optional)</Field.Label>
										<Select.Root type="single" bind:value={preferredMemberId}>
											<Select.Trigger class="w-full">
												{techs.find((t) => t.id === preferredMemberId)?.name ?? 'No preference'}
											</Select.Trigger>
											<Select.Content>
												<Select.Item value="any">No preference</Select.Item>
												{#each techs as t (t.id)}
													<Select.Item value={t.id}>{t.name}</Select.Item>
												{/each}
											</Select.Content>
										</Select.Root>
									</Field.Field>
								{/if}
							</div>
							<Field.Field>
								<Field.Label for="b-addr">Service address</Field.Label>
								<Input id="b-addr" bind:value={address1} placeholder="Street" />
							</Field.Field>
							<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
								<Input bind:value={city} placeholder="City" />
								<Input bind:value={addrState} placeholder="State" />
								<Input bind:value={zip} placeholder="ZIP" />
							</div>
							<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
								<Field.Field>
									<Field.Label for="b-date">Preferred date</Field.Label>
									<Input
										id="b-date"
										type="date"
										min={minDate}
										max={maxDate}
										bind:value={preferredDate}
									/>
									{#if dayClosed}
										<p class="text-xs font-medium text-red-600 dark:text-red-400">
											We're closed that day — pick another.
										</p>
									{/if}
									{#if data.earliestDay}
										<p class="text-xs text-muted-foreground">
											First opening:
											<button
												type="button"
												class="text-primary hover:underline"
												onclick={() => (preferredDate = data.earliestDay!)}
												>{new Date(`${data.earliestDay}T00:00:00`).toLocaleDateString('en-US', {
													weekday: 'short',
													month: 'short',
													day: 'numeric'
												})}</button
											>
										</p>
									{:else if noticeDays > 0}
										<p class="text-xs text-muted-foreground">
											Earliest available day is {minDate}.
										</p>
									{/if}
									{#if dayAvail?.limited}
										{#if dayFull}
											<p class="text-xs font-medium text-red-600 dark:text-red-400">
												That day is fully booked — pick another.
											</p>
										{:else}
											<p class="text-xs text-muted-foreground">
												{dayAvail.remaining} booking slot{dayAvail.remaining === 1 ? '' : 's'} left this
												day.
											</p>
										{/if}
									{/if}
								</Field.Field>
								<Field.Field>
									<Field.Label for="b-when">Preferred time</Field.Label>
									<Input id="b-when" bind:value={preferredTime} placeholder="e.g. morning, ASAP" />
								</Field.Field>
							</div>
							<Field.Field>
								<Field.Label for="b-desc">Describe the work</Field.Label>
								<Textarea
									id="b-desc"
									rows={3}
									bind:value={description}
									placeholder="What's going on?"
								/>
							</Field.Field>
							<Field.Field>
								<Field.Label for="b-source">How did you hear about us?</Field.Label>
								<Input
									id="b-source"
									bind:value={leadSource}
									placeholder="Google, a neighbor, our truck… (optional)"
								/>
							</Field.Field>
							<!-- honeypot -->
							<input
								type="text"
								name="website"
								bind:value={website}
								tabindex="-1"
								autocomplete="off"
								class="pointer-events-none absolute -left-[9999px] opacity-0"
								aria-hidden="true"
							/>
							<Button type="submit" disabled={pending || dayFull || dayClosed}
								>{pending ? 'Sending…' : 'Request service'}</Button
							>
						</form>
					</Card.Content>
				</Card.Root>
				<Card.Root>
					<Card.Header>
						<Card.Title class="text-base">Can't find a time that works?</Card.Title>
						<Card.Description
							>Join the waitlist — we'll call or email you as soon as something opens up.</Card.Description
						>
					</Card.Header>
					<Card.Content class="px-6 pb-6">
						{#if waitlistDone}
							<p class="text-sm font-medium text-emerald-600 dark:text-emerald-400">
								You're on the list — we'll be in touch.
							</p>
						{:else}
							<form class="space-y-3" onsubmit={joinList}>
								<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
									<Input placeholder="Name" required bind:value={wlName} autocomplete="name" />
									<Input
										placeholder="Phone or email"
										required
										bind:value={wlContact}
										autocomplete="tel"
									/>
									{#if jobTypes.length}
										<Select.Root type="single" bind:value={wlJobTypeId}>
											<Select.Trigger class="w-full">
												{jobTypes.find((t) => t.id === wlJobTypeId)?.name ?? 'Any service'}
											</Select.Trigger>
											<Select.Content>
												<Select.Item value="">Any service</Select.Item>
												{#each jobTypes as t (t.id)}
													<Select.Item value={t.id}>{t.name}</Select.Item>
												{/each}
											</Select.Content>
										</Select.Root>
									{/if}
								</div>
								<Input placeholder="Anything we should know? (optional)" bind:value={wlNote} />
								<Button type="submit" variant="outline" disabled={wlPending}
									>{wlPending ? 'Joining…' : 'Join the waitlist'}</Button
								>
							</form>
						{/if}
					</Card.Content>
				</Card.Root>
			{/if}
		</section>
	</main>
</div>
