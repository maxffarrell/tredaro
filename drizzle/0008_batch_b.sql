ALTER TYPE "public"."estimate_status" ADD VALUE IF NOT EXISTS 'superseded';
--> statement-breakpoint
ALTER TABLE "estimate" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "estimate" ADD COLUMN IF NOT EXISTS "supersedes_id" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "member_time_off" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"member_id" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_time_off_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade,
	CONSTRAINT "member_time_off_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "member_time_off_member_idx" ON "member_time_off" ("member_id","starts_on");

--> statement-breakpoint
DROP INDEX IF EXISTS "estimate_org_number_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "estimate_org_number_idx" ON "estimate" ("organization_id","number","version");
