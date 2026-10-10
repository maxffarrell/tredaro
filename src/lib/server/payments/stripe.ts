import Stripe from 'stripe';
import { error } from '@sveltejs/kit';
import { TREDARO_CLOUD, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { charge, customer, payment, paymentProvider, user } from '#lib/server/db/schema.ts';
import { appOrigin } from '#lib/server/email.ts';
import { and, eq } from 'drizzle-orm';
import { recordOnlinePayment } from './record.ts';
import { providerRow, upsertProvider } from './settings.ts';
import { secretList } from './standard-webhooks.ts';
import type { PaymentProvider } from './types.ts';

let client: Stripe | undefined;

const configured = () => !!STRIPE_SECRET_KEY && !!STRIPE_WEBHOOK_SECRET;

function api() {
	if (!STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set');
	client ??= new Stripe(STRIPE_SECRET_KEY, { appInfo: { name: 'Tredaro' } });
	return client;
}

function verify(body: string, signature: string): Stripe.Event | null {
	for (const secret of secretList(STRIPE_WEBHOOK_SECRET)) {
		try {
			return Stripe.webhooks.constructEvent(body, signature, secret);
		} catch {
			// try the next secret
		}
	}
	return null;
}

async function onCheckoutPaid(event: Stripe.Event, session: Stripe.Checkout.Session) {
	if (session.payment_status !== 'paid' || !session.amount_total) return;
	const orgId = session.metadata?.tredaroOrgId;
	const customerId = session.metadata?.tredaroCustomerId;
	if (!orgId || !customerId) return;
	// Only accept events from the account this workspace actually takes payments with.
	const row = await providerRow(orgId, 'stripe');
	if ((event.account ?? null) !== (row?.accountId ?? null)) return;
	const intent =
		typeof session.payment_intent === 'string'
			? session.payment_intent
			: session.payment_intent?.id;
	const chargeIds = session.metadata?.tredaroChargeIds?.split(',').filter(Boolean);
	const tipCents = Math.min(
		Math.max(0, parseInt(session.metadata?.tredaroTipCents ?? '0', 10) || 0),
		session.amount_total
	);
	const extId = intent ?? session.id;
	await recordOnlinePayment({
		chargeIds,
		orgId,
		customerId,
		amount: session.amount_total - tipCents,
		// Bank debits complete later through `async_payment_succeeded`; cards complete immediately.
		method: 'stripe',
		externalId: extId,
		provider: 'Stripe'
	});
	// A tip rides along as its own paid 'other' charge so invoice balances stay exact.
	if (tipCents > 0 && session.metadata?.tredaroTipInvoiceId) {
		const today = new Date().toISOString().slice(0, 10);
		const invNum = session.metadata.tredaroTipInvoiceId.slice(0, 8);
		const [tipCharge] = await db
			.insert(charge)
			.values({
				organizationId: orgId,
				customerId,
				invoiceId: session.metadata.tredaroTipInvoiceId,
				kind: 'other',
				description: `Tip — invoice ${invNum}`,
				dueDate: today,
				amount: tipCents,
				status: 'paid'
			})
			.returning();
		await db
			.insert(payment)
			.values({
				organizationId: orgId,
				customerId,
				chargeId: tipCharge.id,
				amount: tipCents,
				method: 'stripe',
				reference: extId,
				notes: 'Tip paid online with Stripe',
				externalId: `${extId}:tip`
			})
			.onConflictDoNothing();
	}
}

async function onCardSaved(event: Stripe.Event, session: Stripe.Checkout.Session) {
	if (session.mode !== 'setup') return;
	const orgId = session.metadata?.tredaroOrgId;
	const customerId = session.metadata?.tredaroCustomerId;
	const stripeCustomer =
		typeof session.customer === 'string' ? session.customer : session.customer?.id;
	const setupIntent =
		typeof session.setup_intent === 'string' ? session.setup_intent : session.setup_intent?.id;
	if (!orgId || !customerId || !stripeCustomer || !setupIntent) return;
	// Only accept events from the account this workspace actually takes payments with.
	const row = await providerRow(orgId, 'stripe');
	if ((event.account ?? null) !== (row?.accountId ?? null)) return;
	const opts = row?.accountId ? { stripeAccount: row.accountId } : undefined;
	const si = await api().setupIntents.retrieve(setupIntent, undefined, opts);
	const pmId = typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id;
	if (!pmId) return;
	const pm = await api().paymentMethods.retrieve(pmId, undefined, opts);
	const label = pm.card
		? `${pm.card.brand?.[0]?.toUpperCase() ?? ''}${pm.card.brand?.slice(1) ?? 'Card'} ····${pm.card.last4}`
		: 'Saved card';
	await db
		.update(customer)
		.set({
			savedCardProvider: 'stripe',
			savedCardCustomer: stripeCustomer,
			savedCardRef: pmId,
			savedCardLabel: label
		})
		.where(and(eq(customer.id, customerId), eq(customer.organizationId, orgId)));
	const { emit } = await import('#lib/server/services/events.ts');
	await emit({
		orgId,
		entityType: 'customer',
		entityId: customerId,
		action: 'card_saved',
		summary: `Saved ${label} for automatic payments`
	});
}

/**
 * Stripe Checkout. Self-hosted installs can take payments into the install's own Stripe
 * account; on Tredaro Cloud each workspace connects its own account (Stripe Connect, Standard).
 */
export const stripeProvider: PaymentProvider = {
	id: 'stripe',
	name: 'Stripe',
	payLabel: 'Pay by card or bank',
	description:
		'Customers pay by card or bank transfer through Stripe Checkout. Money goes straight to your Stripe account.',
	env: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
	webhookEvents: [
		'checkout.session.completed',
		'checkout.session.async_payment_succeeded',
		'account.updated'
	],
	webhookNote:
		'For connected accounts, add the endpoint again with "Listen to events on Connected accounts".',
	configured,
	ready(row) {
		if (!configured()) return false;
		if (row?.accountId) return row.accountReady;
		return !TREDARO_CLOUD;
	},
	setupHint(row) {
		if (row?.accountId && !row.accountReady) return 'Finish setting up your Stripe account first.';
		if (!row?.accountId && TREDARO_CLOUD) return 'Connect a Stripe account first.';
		return null;
	},
	supportsCurrency: () => true,

	async checkout(i) {
		const metadata = {
			...(i.meta ?? {}),
			tredaroOrgId: i.orgId,
			tredaroCustomerId: i.customerId
		};
		const session = await api().checkout.sessions.create(
			{
				mode: 'payment',
				line_items: [
					{
						quantity: 1,
						price_data: {
							currency: i.currency.toLowerCase(),
							unit_amount: i.amount,
							product_data: { name: i.description }
						}
					}
				],
				customer_email: i.email ?? undefined,
				client_reference_id: i.customerId,
				metadata,
				payment_intent_data: { metadata },
				success_url: `${appOrigin()}${i.paths?.success ?? '/portal?paid=1'}`,
				cancel_url: `${appOrigin()}${i.paths?.cancel ?? '/portal'}`
			},
			i.row?.accountId ? { stripeAccount: i.row.accountId } : undefined
		);
		if (!session.url) error(502, 'Stripe did not return a checkout link');
		return session.url;
	},

	async saveCard(i) {
		const metadata = {
			...(i.meta ?? {}),
			tredaroOrgId: i.orgId,
			tredaroCustomerId: i.customerId
		};
		const session = await api().checkout.sessions.create(
			{
				mode: 'setup',
				customer_email: i.email ?? undefined,
				client_reference_id: i.customerId,
				metadata,
				setup_intent_data: { metadata },
				success_url: `${appOrigin()}${i.paths?.success ?? '/portal?card=1'}`,
				cancel_url: `${appOrigin()}${i.paths?.cancel ?? '/portal'}`
			},
			i.row?.accountId ? { stripeAccount: i.row.accountId } : undefined
		);
		if (!session.url) error(502, 'Stripe did not return a setup link');
		return session.url;
	},

	async chargeSaved(i) {
		try {
			const pi = await api().paymentIntents.create(
				{
					amount: i.amount,
					currency: i.currency.toLowerCase(),
					customer: i.customerRef,
					payment_method: i.paymentRef,
					confirm: true,
					off_session: true,
					description: i.description,
					metadata: {
						tredaroOrgId: i.orgId,
						tredaroCustomerId: i.customerId
					}
				},
				i.row?.accountId ? { stripeAccount: i.row.accountId } : undefined
			);
			return pi.status === 'succeeded' || pi.status === 'processing' ? pi.id : null;
		} catch {
			// Declined, requires_action, revoked card — caller falls back to an open charge.
			return null;
		}
	},

	async handleWebhook(body, headers) {
		const signature = headers.get('stripe-signature');
		const event = signature ? verify(body, signature) : null;
		if (!event) return false;
		switch (event.type) {
			case 'checkout.session.completed': {
				const session = event.data.object;
				if (session.mode === 'setup') await onCardSaved(event, session);
				else await onCheckoutPaid(event, session);
				break;
			}
			case 'checkout.session.async_payment_succeeded':
				await onCheckoutPaid(event, event.data.object);
				break;
			case 'account.updated': {
				const account = event.data.object;
				await db
					.update(paymentProvider)
					.set({ accountReady: account.charges_enabled })
					.where(
						and(eq(paymentProvider.provider, 'stripe'), eq(paymentProvider.accountId, account.id))
					);
				break;
			}
		}
		return true;
	},

	account: {
		async connect(ctx, row) {
			let accountId = row?.accountId;
			if (!accountId) {
				const [me] = await db
					.select({ email: user.email })
					.from(user)
					.where(eq(user.id, ctx.userId));
				const account = await api().accounts.create({
					type: 'standard',
					email: me?.email,
					business_profile: { name: ctx.org.name },
					metadata: { tredaroOrgId: ctx.orgId }
				});
				accountId = account.id;
				await upsertProvider(ctx.orgId, 'stripe', { accountId, accountReady: false });
			}
			const base = `${appOrigin()}/settings/payments`;
			const link = await api().accountLinks.create({
				account: accountId,
				type: 'account_onboarding',
				refresh_url: `${base}?connect=retry`,
				return_url: `${base}?connect=done`
			});
			return link.url;
		},
		async refresh(row) {
			return (await api().accounts.retrieve(row.accountId)).charges_enabled;
		}
	}
};
