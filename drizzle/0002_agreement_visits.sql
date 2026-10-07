ALTER TABLE "agreement_plan" ADD COLUMN "job_type_id" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "service_agreement_id" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "agreement_period" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "agreement_visit_no" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "job_agreement_visit_idx" ON "job" USING btree ("service_agreement_id","agreement_period","agreement_visit_no");