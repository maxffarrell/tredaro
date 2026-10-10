ALTER TABLE "job_material" ALTER COLUMN "inventory_item_id" DROP NOT NULL;
ALTER TABLE "job_material" ADD COLUMN "custom_name" text DEFAULT '' NOT NULL;
ALTER TABLE "job_time_entry" ADD COLUMN "break_min" integer DEFAULT 0 NOT NULL;
ALTER TABLE "company_settings" ADD COLUMN "sms_signature" text DEFAULT '' NOT NULL;
