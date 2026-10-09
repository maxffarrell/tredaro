<script lang="ts">
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import Eraser from '@lucide/svelte/icons/eraser';

	let {
		open = $bindable(false),
		pending = false,
		onSave,
		skipLabel,
		onSkip,
		note = $bindable('')
	}: {
		open?: boolean;
		pending?: boolean;
		onSave: (name: string, dataUrl: string) => void;
		skipLabel?: string;
		onSkip?: () => void;
		note?: string;
	} = $props();

	let canvas: HTMLCanvasElement | undefined = $state();
	let nameEl: HTMLInputElement | null = $state(null);
	let hasName = $state(false);
	let drawn = $state(false);
	let drawing = false;
	let ctx2d: CanvasRenderingContext2D | null = null;
	let last: { x: number; y: number } | null = null;

	function setup() {
		if (!canvas) return;
		ctx2d = canvas.getContext('2d');
		if (!ctx2d) return;
		ctx2d.lineWidth = 2.5;
		ctx2d.lineCap = 'round';
		ctx2d.lineJoin = 'round';
		ctx2d.strokeStyle = '#111';
		ctx2d.fillStyle = '#fff';
		ctx2d.fillRect(0, 0, canvas.width, canvas.height);
	}

	function clear() {
		if (!canvas || !ctx2d) return;
		ctx2d.fillStyle = '#fff';
		ctx2d.fillRect(0, 0, canvas.width, canvas.height);
		ctx2d.fillStyle = '#fff';
		drawn = false;
	}

	function pos(e: PointerEvent) {
		const r = canvas!.getBoundingClientRect();
		return {
			x: ((e.clientX - r.left) / r.width) * canvas!.width,
			y: ((e.clientY - r.top) / r.height) * canvas!.height
		};
	}

	function down(e: PointerEvent) {
		e.preventDefault();
		drawing = true;
		last = pos(e);
	}
	function move(e: PointerEvent) {
		if (!drawing || !ctx2d || !last) return;
		const p = pos(e);
		ctx2d.beginPath();
		ctx2d.moveTo(last.x, last.y);
		ctx2d.lineTo(p.x, p.y);
		ctx2d.stroke();
		last = p;
		drawn = true;
	}
	function up() {
		drawing = false;
		last = null;
	}

	$effect(() => {
		if (open) {
			hasName = false;
			drawn = false;
			requestAnimationFrame(() => {
				setup();
				if (nameEl) nameEl.value = '';
			});
		}
	});

	function save() {
		const name = nameEl?.value.trim() ?? '';
		if (!canvas || !drawn || !name) return;
		onSave(name, canvas.toDataURL('image/png'));
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Customer signature</Dialog.Title>
			<Dialog.Description>Have the customer sign to confirm the work.</Dialog.Description>
		</Dialog.Header>
		<div class="grid gap-3">
			<canvas
				bind:this={canvas}
				width={600}
				height={200}
				class="h-40 w-full touch-none rounded-md border bg-white"
				onpointerdown={down}
				onpointermove={move}
				onpointerup={up}
				onpointerleave={up}
			></canvas>
			<div class="grid gap-1.5">
				<Label for="sig-work">Work performed (optional)</Label>
				<Textarea
					id="sig-work"
					bind:value={note}
					rows={2}
					placeholder="Replaced capacitor, tested cooling…"
				/>
			</div>
			<div class="flex items-end justify-between gap-2">
				<div class="grid flex-1 gap-1.5">
					<Label for="sig-name">Printed name</Label>
					<Input
						id="sig-name"
						bind:ref={nameEl}
						autocomplete="off"
						oninput={() => (hasName = !!nameEl?.value.trim())}
					/>
				</div>
				<Button variant="ghost" size="icon" onclick={clear} title="Clear"><Eraser /></Button>
			</div>
		</div>
		<Dialog.Footer class="flex-col gap-2 sm:flex-row">
			{#if onSkip}
				<Button variant="ghost" disabled={pending} onclick={onSkip}>{skipLabel ?? 'Skip'}</Button>
			{/if}
			<Button disabled={pending || !drawn || !hasName} onclick={save}>Sign &amp; confirm</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
