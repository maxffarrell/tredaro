ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "estimate_deposit_pct" integer DEFAULT 0 NOT NULL;
