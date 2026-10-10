ALTER TABLE "job_type" ADD COLUMN "labor_warranty_days" integer DEFAULT 0 NOT NULL;
ALTER TABLE "job" ADD COLUMN "warranty_until" timestamp with time zone;
ALTER TABLE "inventory_item" ADD COLUMN "preferred_supplier" text DEFAULT '' NOT NULL;
