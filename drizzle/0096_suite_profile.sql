-- Idempotent: an earlier journal timestamp let fresh databases apply this before 0095.
CREATE TABLE IF NOT EXISTS "profile_link" (
	"user_id" text PRIMARY KEY NOT NULL,
	"hub_url" text NOT NULL,
	"access_token" text NOT NULL,
	"scopes" text[] NOT NULL,
	"data" jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "profile_link" ADD CONSTRAINT "profile_link_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "profile_sync" boolean DEFAULT false NOT NULL;
