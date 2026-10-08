ALTER TYPE "agreement_status" ADD VALUE 'completed';
ALTER TABLE "company_settings" ADD COLUMN "booking_enabled" boolean DEFAULT true NOT NULL;
ALTER TABLE "service_agreement" ADD COLUMN "max_periods" integer;
