ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "lead_source" text;
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "email_notifications" boolean DEFAULT true NOT NULL;
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "sms_notifications" boolean DEFAULT true NOT NULL;
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "staff_digest" boolean DEFAULT true NOT NULL;
ALTER TABLE "member" ADD COLUMN IF NOT EXISTS "commission_pct" integer DEFAULT 0 NOT NULL;
