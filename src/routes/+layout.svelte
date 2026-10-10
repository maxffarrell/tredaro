<script lang="ts">
	import './layout.css';
	import { browser, dev } from '$app/env';
	import { onMount } from 'svelte';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '#lib/components/ui/sonner/index.js';
	import favicon from '#lib/assets/favicon.svg';

	let { children } = $props();

	// PWA: prod-only service worker so dev/QA never fights a stale cache.
	onMount(() => {
		if (browser && !dev && 'serviceWorker' in navigator)
			void navigator.serviceWorker.register('/sw.js');
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link rel="manifest" href="/manifest.webmanifest" />
	<meta name="theme-color" content="#18181b" />
	<link rel="apple-touch-icon" href="/icon-192.png" />
</svelte:head>
<ModeWatcher />
<Toaster richColors closeButton />
{@render children()}
