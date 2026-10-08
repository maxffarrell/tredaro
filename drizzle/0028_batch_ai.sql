ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "booking_daily_limit" integer DEFAULT 0 NOT NULL;
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "late_fee_cents" integer DEFAULT 0 NOT NULL;

CREATE TABLE IF NOT EXISTS "sms_outbox" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
	"to" text NOT NULL,
	"body" text NOT NULL,
	"send_after" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "sms_outbox_pending_idx" ON "sms_outbox" ("organization_id", "send_after") WHERE "sent_at" IS NULL;
