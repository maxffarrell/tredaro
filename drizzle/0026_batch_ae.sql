ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "tax_rate_bps" integer DEFAULT 0 NOT NULL;
