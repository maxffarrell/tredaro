<script lang="ts">
	import * as Card from '#lib/components/ui/card/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import Logo from '#lib/components/app/logo.svelte';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { formatDate } from '#lib/format.ts';
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let pending = $state(false);
	const done = $derived(!!form?.cancelled || data.cancelled);
	const cancellable = $derived(
		!data.cancelled && data.job.status !== 'done' && data.job.status !== 'in_progress'
	);
</script>

<svelte:head>
	<title>Cancel visit J-{data.job.number} — {data.orgName}</title>
</svelte:head>

<div class="flex min-h-dvh items-center justify-center bg-muted/40 p-4">
	<Card.Root class="w-full max-w-md">
		<Card.Header class="items-center text-center">
			<Logo class="h-7" />
			<Card.Title class="text-lg">{data.orgName}</Card.Title>
			<Card.Description>Visit J-{data.job.number}</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4 text-center">
			{#if done}
				<CircleCheck class="mx-auto size-10 text-green-600" />
				<p class="font-medium">This visit has been cancelled.</p>
				<p class="text-sm text-muted-foreground">
					{#if form?.already || data.cancelled}
						It was already cancelled — no action needed.
					{:else}
						We've let the office know. Call us any time to rebook.
					{/if}
				</p>
			{:else if !cancellable}
				<CircleAlert class="mx-auto size-10 text-amber-500" />
				<p class="font-medium">This visit can't be cancelled online.</p>
				<p class="text-sm text-muted-foreground">
					It's already {data.job.status === 'done' ? 'completed' : 'under way'} — please call {data.orgName}
					directly.
				</p>
			{:else}
				<p class="font-medium">
					Cancel your {data.typeName ?? 'service'} visit{data.job.startsAt
						? ` on ${formatDate(data.job.startsAt)}`
						: ''}?
				</p>
				{#if data.address}
					<p class="text-sm text-muted-foreground">{data.address}</p>
				{/if}
				<p class="text-sm text-muted-foreground">
					We'll notify the office right away. You can rebook any time.
				</p>
				<form
					method="POST"
					use:enhance={() => {
						pending = true;
						return async ({ update }) => {
							pending = false;
							await update();
						};
					}}
				>
					<Button type="submit" variant="destructive" class="w-full" disabled={pending}>
						{pending ? 'Cancelling…' : 'Yes, cancel this visit'}
					</Button>
				</form>
				<p class="text-center text-sm text-muted-foreground">
					Just need a different time?
					<a
						href="/book/reschedule/{page.params.token}"
						class="font-medium text-foreground underline">Request a reschedule</a
					> instead.
				</p>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
