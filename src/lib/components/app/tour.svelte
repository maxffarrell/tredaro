<script lang="ts">
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { tour } from './tour.svelte.ts';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import X from '@lucide/svelte/icons/x';

	const sidebar = Sidebar.useSidebar();
	const CARD_W = 320;
	const CARD_H = 200;

	let rect = $state<{ top: number; left: number; width: number; height: number } | null>(null);
	let vw = $state(0);
	let vh = $state(0);

	function measure() {
		vw = window.innerWidth;
		vh = window.innerHeight;
		const t = tour.step?.target;
		if (!t) {
			rect = null;
			return;
		}
		const el = document.querySelector(`[data-tour="${t}"]`);
		if (!el) {
			rect = null;
			return;
		}
		const r = el.getBoundingClientRect();
		rect =
			r.width > 0 && r.height > 0
				? { top: r.top, left: r.left, width: r.width, height: r.height }
				: null;
	}

	$effect(() => {
		if (!tour.open) {
			if (sidebar.isMobile) sidebar.setOpenMobile(false);
			return;
		}
		void tour.index;
		// On phones the anchors live inside the off-canvas sidebar sheet.
		if (sidebar.isMobile && tour.step?.target) sidebar.setOpenMobile(true);
		let tries = 0;
		const tick = () => {
			measure();
			if (!rect && tour.step?.target && ++tries < 20) timer = setTimeout(tick, 100);
		};
		let timer = setTimeout(tick, 50);
		const onChange = () => measure();
		window.addEventListener('resize', onChange);
		window.addEventListener('scroll', onChange, true);
		return () => {
			clearTimeout(timer);
			window.removeEventListener('resize', onChange);
			window.removeEventListener('scroll', onChange, true);
		};
	});

	// Card position: right of the target when it fits (sidebar items), else below/above, else centered.
	const cardStyle = $derived.by(() => {
		if (!rect || !vw)
			return `left:50%;top:50%;transform:translate(-50%,-50%);width:${Math.min(CARD_W, (vw || 400) - 32)}px`;
		let left = rect.left + rect.width + 16;
		if (left + CARD_W > vw - 16) left = Math.max(16, Math.min(rect.left, vw - CARD_W - 16));
		let top = rect.top + rect.height / 2 - CARD_H / 2;
		top = Math.max(16, Math.min(top, vh - CARD_H - 16));
		return `left:${left}px;top:${top}px;width:${CARD_W}px`;
	});

	function onKeydown(e: KeyboardEvent) {
		if (!tour.open) return;
		if (e.key === 'Escape') tour.finish();
		else if (e.key === 'ArrowRight' || e.key === 'Enter') tour.next();
		else if (e.key === 'ArrowLeft') tour.back();
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if tour.open}
	<div class="fixed inset-0 z-[100]" role="dialog" aria-label="Guided tour">
		{#if rect}
			<div
				class="pointer-events-none fixed rounded-lg border-2 border-primary shadow-[0_0_0_9999px_rgb(0_0_0/0.55)] transition-all duration-200"
				style="top:{rect.top - 4}px;left:{rect.left - 4}px;width:{rect.width +
					8}px;height:{rect.height + 8}px"
			></div>
		{:else}
			<div class="absolute inset-0 bg-black/55"></div>
		{/if}

		<Card.Root class="fixed z-10 shadow-xl" style={cardStyle}>
			<Card.Header class="pb-2">
				<div class="flex items-start justify-between gap-2">
					<Card.Title class="text-base">{tour.step.title}</Card.Title>
					<Button
						variant="ghost"
						size="icon"
						class="-mt-1 -mr-2 size-7 text-muted-foreground"
						title="End tour"
						onclick={() => tour.finish()}><X class="size-4" /></Button
					>
				</div>
			</Card.Header>
			<Card.Content class="pb-3">
				<p class="text-sm text-muted-foreground">{tour.step.body}</p>
			</Card.Content>
			<Card.Footer class="flex items-center justify-between">
				<span class="text-xs text-muted-foreground tabular-nums"
					>{tour.index + 1} / {tour.total}</span
				>
				<div class="flex gap-2">
					{#if tour.index > 0}
						<Button variant="ghost" size="sm" onclick={() => tour.back()}
							><ChevronLeft class="size-4" /> Back</Button
						>
					{/if}
					<Button size="sm" onclick={() => tour.next()}
						>{tour.index + 1 === tour.total ? 'Done' : 'Next'}</Button
					>
				</div>
			</Card.Footer>
		</Card.Root>
	</div>
{/if}
