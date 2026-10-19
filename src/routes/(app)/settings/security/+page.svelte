<script lang="ts">
	/* Basic SSO and passkey management are included in the MIT core. */
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { authClient } from '#lib/auth-client.ts';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { toast } from 'svelte-sonner';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const isAdmin = $derived(page.data.role !== 'member');

	let passkeys = $state<{ id: string; name?: string | null; createdAt: Date }[]>([]);
	onMount(() => {
		if (data.security)
			void authClient.passkey
				.listUserPasskeys()
				.then((r) => (passkeys = (r.data as typeof passkeys) ?? []));
	});

	async function addPasskey() {
		const res = await authClient.passkey.addPasskey({ name: navigator.platform || 'Passkey' });
		if (res?.error) return toast.error(res.error.message ?? 'Could not add passkey');
		toast.success('Passkey added');
		passkeys = ((await authClient.passkey.listUserPasskeys()).data as typeof passkeys) ?? [];
	}

	let protocol = $state<'oidc' | 'saml'>('oidc');
	let domain = $state('');
	let issuer = $state('');
	let clientId = $state('');
	let clientSecret = $state('');
	let entryPoint = $state('');
	let cert = $state('');

	async function registerSso(e: SubmitEvent) {
		e.preventDefault();
		const base = {
			providerId: domain.replace(/\W+/g, '-'),
			domain,
			issuer,
			organizationId: page.data.org!.id
		};
		const { error } = await authClient.sso.register(
			protocol === 'oidc'
				? { ...base, oidcConfig: { clientId, clientSecret } }
				: {
						...base,
						samlConfig: {
							entryPoint,
							cert,
							callbackUrl: `${location.origin}/api/auth/sso/saml2/callback/${base.providerId}`,
							spMetadata: {}
						}
					}
		);
		if (error) return toast.error(error.message ?? 'Could not save SSO connection');
		toast.success('SSO connection saved. Members with that email domain can now sign in with SSO.');
	}
</script>

{#if data.security}
	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2">Passkeys</Card.Title>
			<Card.Description
				>Sign in with Face ID, Touch ID, Windows Hello or a security key.</Card.Description
			>
		</Card.Header>
		<Card.Content class="space-y-3">
			{#each passkeys as pk (pk.id)}
				<p class="flex items-center gap-2 text-sm">
					<KeyRound class="size-4 text-muted-foreground" />
					{pk.name ?? 'Passkey'}
				</p>
			{:else}
				<p class="text-sm text-muted-foreground">No passkeys yet.</p>
			{/each}
			<Button variant="outline" onclick={addPasskey}><KeyRound /> Add a passkey</Button>
		</Card.Content>
	</Card.Root>

	{#if isAdmin}
		<Card.Root>
			<Card.Header>
				<Card.Title class="flex items-center gap-2">Single sign-on</Card.Title>
				<Card.Description
					>Connect Okta, Entra ID, Google Workspace or any SAML 2.0 / OIDC provider. New users are
					added to this workspace as members.</Card.Description
				>
			</Card.Header>
			<Card.Content>
				<form class="space-y-4" onsubmit={registerSso}>
					<ToggleGroup.Root
						type="single"
						variant="outline"
						size="sm"
						bind:value={() => protocol, (v) => v && (protocol = v as 'oidc' | 'saml')}
					>
						<ToggleGroup.Item value="oidc">OIDC</ToggleGroup.Item>
						<ToggleGroup.Item value="saml">SAML</ToggleGroup.Item>
					</ToggleGroup.Root>
					<Field.Group class="gap-4">
						<div class="grid gap-3 sm:grid-cols-2">
							<Field.Field
								><Field.Label for="sso-domain">Email domain</Field.Label><Input
									id="sso-domain"
									placeholder="acme.com"
									required
									bind:value={domain}
								/></Field.Field
							>
							<Field.Field
								><Field.Label for="sso-issuer">Issuer URL</Field.Label><Input
									id="sso-issuer"
									type="url"
									placeholder="https://acme.okta.com"
									required
									bind:value={issuer}
								/></Field.Field
							>
						</div>
						{#if protocol === 'oidc'}
							<div class="grid gap-3 sm:grid-cols-2">
								<Field.Field
									><Field.Label for="sso-cid">Client ID</Field.Label><Input
										id="sso-cid"
										required
										bind:value={clientId}
									/></Field.Field
								>
								<Field.Field
									><Field.Label for="sso-secret">Client secret</Field.Label><Input
										id="sso-secret"
										type="password"
										required
										bind:value={clientSecret}
									/></Field.Field
								>
							</div>
						{:else}
							<Field.Field
								><Field.Label for="sso-entry">SSO URL (entry point)</Field.Label><Input
									id="sso-entry"
									type="url"
									required
									bind:value={entryPoint}
								/></Field.Field
							>
							<Field.Field
								><Field.Label for="sso-cert">X.509 certificate</Field.Label><Textarea
									id="sso-cert"
									rows={4}
									class="font-mono text-xs"
									required
									bind:value={cert}
								/></Field.Field
							>
						{/if}
					</Field.Group>
					<Button type="submit">Save connection</Button>
				</form>
			</Card.Content>
		</Card.Root>
	{/if}
{:else}
	<p class="text-sm text-muted-foreground">Sign-in settings are turned off in the public demo.</p>
{/if}
