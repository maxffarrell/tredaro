<script lang="ts">
	import * as Card from '#lib/components/ui/card/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import Logo from '#lib/components/app/logo.svelte';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { formatDate } from '#lib/format.ts';
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let pending = $state(false);
	let date = $state('');
	let slot = $state('');
	const slots = ['Morning', 'Afternoon', 'Evening', 'First available'];
	const done = $derived(!!form?.sent);
	const reschedulable = $derived(
		!data.cancelled && data.job.status !== 'done' && data.job.status !== 'in_progress'
	);
</script>

<svelte:head>
	<title>Reschedule visit J-{data.job.number} — {data.orgName}</title>
</svelte:head>

<div class="flex min-h-dvh items-center justify-center bg-muted/40 p-4">
	<Card.Root class="w-full max-w-md">
		<Card.Header class="items-center text-center">
			<Logo class="h-7" />
			<Card.Title class="text-lg">{data.orgName}</Card.Title>
			<Card.Description>Visit J-{data.job.number}</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			{#if done}
				<CircleCheck class="mx-auto size-10 text-green-600" />
				<p class="text-center font-medium">Request sent!</p>
				<p class="text-center text-sm text-muted-foreground">
					We'll confirm the new time shortly. The visit stays on the calendar until then.
				</p>
			{:else if data.pendingRequest}
				<CircleCheck class="mx-auto size-10 text-green-600" />
				<p class="text-center font-medium">Reschedule already requested</p>
				<p class="text-center text-sm text-muted-foreground">
					You asked for <span class="font-medium">{data.pendingRequest}</span> — we'll confirm shortly.
					Submit again below to change it.
				</p>
			{/if}
			{#if !done && !reschedulable}
				<CircleAlert class="mx-auto size-10 text-amber-500" />
				<p class="text-center font-medium">This visit can't be rescheduled online.</p>
				<p class="text-center text-sm text-muted-foreground">
					{#if data.cancelled}
						It was cancelled — please rebook online or call {data.orgName}.
					{:else}
						It's already {data.job.status === 'done' ? 'completed' : 'under way'} — please call {data.orgName}
						directly.
					{/if}
				</p>
			{:else if !done}
				<p class="text-center font-medium">
					Need a different time for your {data.typeName ?? 'service'} visit{data.job.startsAt
						? ` on ${formatDate(data.job.startsAt)}`
						: ''}?
				</p>
				{#if data.address}
					<p class="text-center text-sm text-muted-foreground">{data.address}</p>
				{/if}
				<form
					method="POST"
					class="space-y-3"
					use:enhance={() => {
						pending = true;
						return async ({ update }) => {
							pending = false;
							await update();
						};
					}}
				>
					<div class="space-y-1.5">
						<Label for="date">Preferred day</Label>
						<Input
							id="date"
							name="date"
							type="date"
							bind:value={date}
							min={new Date().toISOString().slice(0, 10)}
						/>
					</div>
					<div class="space-y-1.5">
						<Label>Time window</Label>
						<div class="flex flex-wrap gap-2">
							{#each slots as s (s)}
								<Button
									type="button"
									size="sm"
									variant={slot === s ? 'default' : 'outline'}
									onclick={() => (slot = slot === s ? '' : s)}>{s}</Button
								>
							{/each}
						</div>
						<input type="hidden" name="slot" value={slot} />
					</div>
					<div class="space-y-1.5">
						<Label for="note"
							>Anything else? <span class="text-muted-foreground">(optional)</span></Label
						>
						<Input id="note" name="note" placeholder="e.g. after 3pm works best" />
					</div>
					{#if form?.message}
						<p class="text-center text-sm text-destructive">{form.message}</p>
					{/if}
					<Button type="submit" class="w-full" disabled={pending || (!date && !slot)}>
						{pending ? 'Sending…' : 'Request this time'}
					</Button>
				</form>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
