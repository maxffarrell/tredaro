import type { OrgContext } from '#lib/server/context.ts';
import type { paymentProvider } from '#lib/server/db/schema.ts';

export type ProviderRow = typeof paymentProvider.$inferSelect;

export type CheckoutInput = {
	orgId: string;
	customerId: string;
	email: string | null;
	/** Minor units. */
	amount: number;
	currency: string;
	description: string;
	row: ProviderRow | null;
	/** App-relative paths for post-checkout redirects (defaults to the customer portal). */
	paths?: { success: string; cancel: string };
	/** Extra key/values passed through to the provider's session metadata. */
	meta?: Record<string, string>;
};

/**
 * An online payment provider. The provider moves the money; Tredaro only starts checkout
 * and records the payment when the provider's signed webhook confirms it.
 */
export type PaymentProvider = {
	id: string;
	name: string;
	/** Button label in the customer portal. */
	payLabel: string;
	description: string;
	/** Server environment variables that make the provider available. */
	env: string[];
	webhookEvents: string[];
	webhookNote?: string;
	/** Checkout has no return URL, so it opens in a new tab. */
	newTab?: boolean;
	configured(): boolean;
	/** Whether this workspace can take payments with the provider right now. */
	ready(row: ProviderRow | null): boolean;
	/** What is still needed before the provider can be turned on, if anything. */
	setupHint(row: ProviderRow | null): string | null;
	supportsCurrency(currency: string): boolean;
	/** Returns the provider-hosted checkout URL. */
	checkout(input: CheckoutInput): Promise<string>;
	/**
	 * Hosted page where the customer saves a card for future charges (no payment taken).
	 * The provider's webhook writes the saved-card refs onto the customer row.
	 */
	saveCard?(input: CheckoutInput): Promise<string>;
	/**
	 * Charge a previously saved card off-session. Returns the provider payment id on
	 * success, or `null` when the charge cannot complete unattended (e.g. it needs
	 * authentication or the card was declined) — the caller then leaves the charge open.
	 */
	chargeSaved?(input: {
		orgId: string;
		customerId: string;
		email: string | null;
		/** Minor units. */
		amount: number;
		currency: string;
		description: string;
		/** Provider's customer object id. */
		customerRef: string;
		/** Provider's saved payment-method ref. */
		paymentRef: string;
		row: ProviderRow | null;
	}): Promise<string | null>;
	/** Verifies and handles a webhook delivery. Returns `false` when the signature is invalid. */
	handleWebhook(body: string, headers: Headers): Promise<boolean>;
	/** Providers where each workspace connects its own account. */
	account?: {
		connect(ctx: OrgContext, row: ProviderRow | null): Promise<string>;
		/** Re-reads from the provider whether the account can take payments. */
		refresh(row: ProviderRow & { accountId: string }): Promise<boolean>;
	};
};
