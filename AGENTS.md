# Agent notes

- Node 26, pnpm. SvelteKit 3: use `#lib/...` imports (no `$lib`), `$app/env/private` for env, config lives in `vite.config.ts`.
- Remote functions (`query`/`command`) and Svelte async (`await` in components) are enabled.
- Verify with `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Local DB: `DATABASE_URL` in `.env`; apply migrations with `node scripts/migrate.ts`.
- Domain: field service — `customer` + `service_location` + `job`/`job_type`/`job_event` + `estimate` + `invoice` + `agreement_plan`/`service_agreement` + `pricebook_item` + `charge`/`payment`, all org-scoped. Staff auth is Better Auth orgs (`member`/`user`); technicians are staff members. Customers log into the portal via HMAC claim links; the public booking page lives at `/book/[slug]`.
