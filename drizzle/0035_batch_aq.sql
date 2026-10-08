ALTER TABLE "member" ADD COLUMN "staff_alerts" boolean DEFAULT true NOT NULL;
ALTER TABLE "company_settings" ADD COLUMN "service_zips" text DEFAULT '' NOT NULL;
