ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "booking_notice_days" integer DEFAULT 0 NOT NULL;
