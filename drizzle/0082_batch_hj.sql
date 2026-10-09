ALTER TABLE "inventory_item" ADD COLUMN "category" text DEFAULT '' NOT NULL;
ALTER TABLE "customer_document" ADD COLUMN "expires_on" date;
ALTER TABLE "job_time_entry" ADD COLUMN "flagged_at" timestamp with time zone;
ALTER TABLE "job_time_entry" ADD COLUMN "flag_note" text DEFAULT '' NOT NULL;
