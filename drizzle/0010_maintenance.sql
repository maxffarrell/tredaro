ALTER TYPE "job_source" ADD VALUE IF NOT EXISTS 'maintenance';
--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN IF NOT EXISTS "maintenance_schedule_id" text;
--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN IF NOT EXISTS "schedule_period" date;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "maintenance_schedule" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"job_type_id" text,
	"summary" text DEFAULT '' NOT NULL,
	"interval_days" integer NOT NULL,
	"next_due_on" date NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "maintenance_schedule" ADD CONSTRAINT "maintenance_schedule_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "maintenance_schedule" ADD CONSTRAINT "maintenance_schedule_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "maintenance_schedule" ADD CONSTRAINT "maintenance_schedule_job_type_id_job_type_id_fk" FOREIGN KEY ("job_type_id") REFERENCES "public"."job_type"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "job" ADD CONSTRAINT "job_maintenance_schedule_id_maintenance_schedule_id_fk" FOREIGN KEY ("maintenance_schedule_id") REFERENCES "public"."maintenance_schedule"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "maintenance_schedule_customer_idx" ON "maintenance_schedule" USING btree ("customer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "maintenance_schedule_due_idx" ON "maintenance_schedule" USING btree ("organization_id","active","next_due_on");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_schedule_period_idx" ON "job" USING btree ("maintenance_schedule_id","schedule_period");
