<div align="center">

# Tredaro

**Open-source field service management that's fast and easy to use.**

Customers, service locations, dispatch board, estimates, invoices, service agreements and billing, plus a customer portal and a public booking page — in a keyboard-friendly UI. Self-host for free, or use Tredaro Cloud.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmaxffarrell%2Ftredaro&env=DATABASE_URL,BETTER_AUTH_SECRET&envDescription=Postgres%20URL%20and%20a%2032%2B%20char%20random%20secret&stores=%5B%7B%22type%22%3A%22postgres%22%7D%5D)
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template?template=https%3A%2F%2Fgithub.com%2Fmaxffarrell%2Ftredaro&plugins=postgresql&envs=BETTER_AUTH_SECRET&BETTER_AUTH_SECRETDesc=32%2B+random+characters)
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/maxffarrell/tredaro)
[![Deploy to Koyeb](https://www.koyeb.com/static/images/deploy/button.svg)](https://app.koyeb.com/deploy?name=tredaro&type=git&repository=github.com/maxffarrell/tredaro&branch=main&builder=dockerfile&ports=3000;http&env[BETTER_AUTH_SECRET]=&env[DATABASE_URL]=)
[![Deploy to DO](https://www.deploytodo.com/do-btn-deploy.svg)](https://cloud.digitalocean.com/apps/new?repo=https://github.com/maxffarrell/tredaro/tree/main)
[![Deploy on Hostinger](https://img.shields.io/badge/Deploy%20on-Hostinger-673DE6?logo=hostinger&logoColor=white)](https://www.hostinger.com/vps/docker-hosting?compose=https%3A%2F%2Fraw.githubusercontent.com%2Fmaxffarrell%2Ftredaro%2Fmain%2Fdocker-compose.yml)

</div>

## Features

- **Customers**: searchable roster, residential/commercial, service locations, per-customer balances and portal invite links
- **Jobs & dispatch**: unscheduled queue, technician board, status events (dispatched → en route → on site → done), priorities, job types with colors
- **Estimates**: line-item builder, shareable public approve/decline links (`/e/[token]`); approval converts to a job
- **Billing**: invoices from completed jobs (prefilled from the estimate or flat rate), charges, payments with oldest-first allocation, customer balances; Stripe Checkout/Connect for online card payments
- **Service agreements**: monthly/annual plans with initial fees; period charges post automatically
- **Pricebook**: flat-rate items (code, category, tax flag)
- **Customer portal**: scheduled visits, open balance + pay online, pending estimates, request-service form
- **Public booking page** (`/book/[company]`): company info, agreement plans, anti-spam service-request form that lands in the unscheduled queue
- **Command palette** (<kbd>⌘K</kbd>), `g d`/`g p`/`g j`/`g c`/`g e`/`g b`/`g a`/`g k`/`g r`/`g t` nav shortcuts
- **REST API + API keys** (`td_`), signed **webhooks** (`x-tredaro-signature`), and an MIT **SDK** in `packages/sdk`
- **Enterprise** (Cloud or `TREDARO_ENTERPRISE_KEY`): SAML & OIDC single sign-on, passkeys, and AI features (BYOK — set `TREDARO_AI_API_KEY`/`TREDARO_AI_MODEL`, optionally `TREDARO_AI_BASE_URL`, to any OpenAI-compatible endpoint). First feature: AI-suggested invoice line items drafted from the job's notes and your pricebook

Out of scope by design: payroll, inventory and fleet tracking. Webhooks + the REST API are the integration surface.

## Quick start

```sh
docker compose up -d db        # or bring your own Postgres
cp .env.example .env           # set DATABASE_URL and BETTER_AUTH_SECRET
pnpm install
pnpm db:migrate
pnpm dev
```

Open http://localhost:5173, create an account, then click **Explore with demo data**.

### Self-hosting

| Target       | How                                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------------------- |
| Docker       | `BETTER_AUTH_SECRET=$(openssl rand -hex 32) docker compose up -d`                                              |
| Railway      | Button above. Uses `railway.json` + `Dockerfile` with a Postgres plugin.                                       |
| Vercel       | Button above. Uses `@sveltejs/adapter-vercel` automatically when `VERCEL=1`. Migrations run during the build.  |
| Render       | Button above. `render.yaml` provisions a Docker web service and a Postgres database.                           |
| Koyeb        | Button above. Builds the `Dockerfile`; add a Postgres (Koyeb PostgreSQL or free Neon) and set `DATABASE_URL`.  |
| DigitalOcean | Button above. `.do/deploy.template.yaml` creates the app and a dev Postgres on App Platform.                   |
| Hostinger    | Button above or [docs/deploy-hostinger.md](docs/deploy-hostinger.md) (VPS Docker Manager).                     |
| Any VPS      | [docs/deploy-vps.md](docs/deploy-vps.md) — same compose file on a ~$4 Hetzner VM or Oracle's always-free tier. |
| Fly.io       | [docs/deploy-fly.md](docs/deploy-fly.md) — `fly launch` using `fly.toml`, scales to zero when idle.            |
| PikaPods     | Not yet in their app catalog — once submitted, a `Run on PikaPods` badge goes here (~$1.50/mo managed).        |

Environment variables are documented in [`src/env.ts`](src/env.ts).

## Scheduled jobs

Agreement billing (posting each period's charge and marking overdue charges) runs whenever someone opens the app. The same endpoint also sends automated reminders: appointment reminders to customers (email + SMS, jobs starting within 36h), follow-ups on sent estimates idle for a week, and a morning digest of today's schedule to each technician. To run it on time every day, set `CRON_SECRET` and call `GET /api/cron` with `Authorization: Bearer $CRON_SECRET`. On Vercel, the cron in `vercel.json` does this for you. Elsewhere, use any scheduler, for example:

```sh
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://dispatch.acme-hvac.com/api/cron
```

## REST API

Keys are created in **Settings → API** and are org-scoped, with per-resource read/write grants. `GET /api/v1/openapi.json` serves a machine-readable spec.

```sh
curl -H "Authorization: Bearer td_..." https://dispatch.acme-hvac.com/api/v1/customers
```

Webhooks (Settings → Webhooks) are signed with HMAC-SHA256 in `x-tredaro-signature` (Standard Webhooks style; see `packages/sdk`).

## License

AGPLv3 for the core. `ee/`/`src/lib/server/ee/` under the Tredaro Enterprise License (SAML/OIDC SSO, passkeys, AI — free with `TREDARO_ENTERPRISE_KEY` or on Tredaro Cloud). `packages/sdk` is MIT.
