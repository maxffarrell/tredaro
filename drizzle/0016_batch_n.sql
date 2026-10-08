ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "preferred_member_id" text;
--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_preferred_member_id_member_id_fk" FOREIGN KEY ("preferred_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;
