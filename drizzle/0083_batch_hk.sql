ALTER TABLE "company_settings" ADD COLUMN "materials_markup_bps" integer DEFAULT 0 NOT NULL;
ALTER TABLE "inventory_item" ADD COLUMN "billable" boolean DEFAULT true NOT NULL;
ALTER TABLE "job" ADD COLUMN "helper_id" text;
ALTER TABLE "job" ADD CONSTRAINT "job_helper_id_member_id_fk" FOREIGN KEY ("helper_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;
