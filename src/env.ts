import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	DATABASE_URL: { description: 'Postgres connection string.' },
	BETTER_AUTH_SECRET: {
		description: 'Secret used to sign sessions. Use 32+ random characters in production.'
	},
	ORIGIN: {
		description:
			'Public origin, e.g. `https://dispatch.acme-hvac.com`. Optional; derived from the request when unset.',
		schema: (value) => value || undefined
	},
	TREDARO_ENTERPRISE_KEY: {
		description:
			'Enterprise license key. Unlocks SAML/OIDC SSO and passkeys on self-hosted installs.',
		schema: (value) => value || undefined
	},
	TREDARO_DEMO: {
		description:
			'Set to `true` for a public demo: visitors get a throwaway sample workspace (deleted after 24h), and sign-up, API access, webhooks, invites and uploads are disabled.',
		schema: (value) => value === 'true'
	},
	EMAIL_FROM: {
		description: 'Sender for notification emails, e.g. `Tredaro <no-reply@acme-hvac.com>`.',
		schema: (value) => value || undefined
	},
	RESEND_API_KEY: {
		description: 'Send email through Resend. Takes precedence over `SMTP_URL`.',
		schema: (value) => value || undefined
	},
	SMTP_URL: {
		description: 'Send email through SMTP, e.g. `smtps://user:pass@smtp.example.com:465`.',
		schema: (value) => value || undefined
	},
	STRIPE_SECRET_KEY: {
		description:
			'Stripe secret key. Lets customers pay online with Stripe Checkout; money goes straight to Stripe, never through Tredaro.',
		schema: (value) => value || undefined
	},
	STRIPE_WEBHOOK_SECRET: {
		description:
			'Signing secret(s) for `/api/payments/stripe/webhook`. Comma-separate several (e.g. account and Connect endpoints).',
		schema: (value) => value || undefined
	},
	UPLOADS_DIR: {
		description: 'Directory for uploaded job photos. Defaults to `data/uploads`.',
		schema: (value) => value || undefined
	},
	CRON_SECRET: {
		description:
			'Bearer token for `/api/cron`, which posts service-agreement charges and sends daily reminders (appointment reminders, estimate follow-ups, staff digests) for every workspace. Vercel Cron sends it automatically.',
		schema: (value) => value || undefined
	},
	TREDARO_CLOUD: {
		description:
			'Set to `true` on Tredaro Cloud. Enables enterprise features and cloud-only behaviour.',
		schema: (value) => value === 'true'
	},
	TREDARO_AI_BASE_URL: {
		description:
			'OpenAI-compatible API base for enterprise AI features, e.g. `https://api.openai.com/v1` or a self-hosted gateway. Defaults to OpenAI.',
		schema: (value) => value || undefined
	},
	TREDARO_AI_API_KEY: {
		description: 'API key for the configured AI endpoint. Bring-your-own-key — no key is bundled.',
		schema: (value) => value || undefined
	},
	TREDARO_AI_MODEL: {
		description: 'Chat model name the endpoint should run, e.g. `gpt-5-mini`.',
		schema: (value) => value || undefined
	},
	TREDARO_AI_DECISION_BASE_URL: {
		description:
			'Optional separate OpenAI-compatible base for structured decision calls (JSON outputs the app parses). Falls back to `TREDARO_AI_BASE_URL`.',
		schema: (value) => value || undefined
	},
	TREDARO_AI_DECISION_API_KEY: {
		description:
			'Optional separate API key for decision calls. Falls back to `TREDARO_AI_API_KEY` — a single key still enables everything.',
		schema: (value) => value || undefined
	},
	TREDARO_AI_DECISION_MODEL: {
		description:
			'Optional separate model for structured decision calls (e.g. a cheaper or stricter-JSON model). Falls back to `TREDARO_AI_MODEL`.',
		schema: (value) => value || undefined
	},
	TREDARO_TWILIO_ACCOUNT_SID: {
		description:
			'Twilio account SID for SMS notifications (job scheduled / tech en route / job completed). Bring-your-own-account; all three Twilio vars are required.',
		schema: (value) => value || undefined
	},
	TREDARO_TWILIO_AUTH_TOKEN: {
		description: 'Auth token for the Twilio account.',
		schema: (value) => value || undefined
	},
	TREDARO_TWILIO_FROM: {
		description:
			'From number (E.164, e.g. `+15551234567`) or Messaging Service SID the texts are sent from.',
		schema: (value) => value || undefined
	},
	TREDARO_TWILIO_BASE_URL: {
		description:
			'API base for the SMS endpoint, e.g. a Twilio-compatible gateway. Defaults to `https://api.twilio.com/2010-04-01`.',
		schema: (value) => value || undefined
	}
});
