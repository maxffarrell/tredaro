CREATE TABLE IF NOT EXISTS "job_expense" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"job_id" text NOT NULL,
	"description" text NOT NULL,
	"vendor" text DEFAULT '' NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"incurred_on" date,
	"member_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_expense" ADD CONSTRAINT "job_expense_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "job_expense" ADD CONSTRAINT "job_expense_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "job_expense" ADD CONSTRAINT "job_expense_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_expense_job_idx" ON "job_expense" USING btree ("job_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_expense_org_idx" ON "job_expense" USING btree ("organization_id");
