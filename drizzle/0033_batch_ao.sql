ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "labor_rounding_min" integer NOT NULL DEFAULT 0;
