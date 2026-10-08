ALTER TYPE "public"."estimate_status" ADD VALUE IF NOT EXISTS 'expired';
ALTER TABLE "estimate" ADD COLUMN IF NOT EXISTS "valid_until" date;
ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "sms_opt_out" boolean DEFAULT false NOT NULL;
ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "email_opt_out" boolean DEFAULT false NOT NULL;
