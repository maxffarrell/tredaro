ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "invoice_terms_days" integer DEFAULT 30 NOT NULL;
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "auto_invoice_on_complete" boolean DEFAULT false NOT NULL;
