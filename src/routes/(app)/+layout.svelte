<script lang="ts">
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import AppSidebar from '#lib/components/app/app-sidebar.svelte';
	import CommandPalette from '#lib/components/app/command-palette.svelte';
	import Tour from '#lib/components/app/tour.svelte';
	import { tour } from '#lib/components/app/tour.svelte.ts';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();
	let searchOpen = $state(false);

	// First visit to the workspace: walk the interface once. Replayable from
	// Settings → General or the account menu.
	$effect(() => {
		tour.init();
	});
</script>

<Sidebar.Provider>
	<AppSidebar user={data.user} org={data.org} onsearch={() => (searchOpen = true)} />
	<Sidebar.Inset>
		<main class="min-w-0 flex-1">
			{@render children()}
		</main>
	</Sidebar.Inset>
	<Tour />
</Sidebar.Provider>
<CommandPalette bind:open={searchOpen} />
