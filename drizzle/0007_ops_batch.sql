ALTER TABLE "job_type" ADD COLUMN IF NOT EXISTS "checklist" text[];
--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "tags" text[];
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_checklist_item" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"job_id" text NOT NULL,
	"label" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"done_at" timestamp with time zone,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_checklist_item_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade,
	CONSTRAINT "job_checklist_item_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_checklist_job_idx" ON "job_checklist_item" ("job_id","sort");
