ALTER TABLE "job" ADD COLUMN IF NOT EXISTS "signature" text;
--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN IF NOT EXISTS "signed_name" text;
--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN IF NOT EXISTS "signed_at" timestamp with time zone;
