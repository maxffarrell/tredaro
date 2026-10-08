ALTER TABLE "sms_outbox" ADD COLUMN "provider_sid" text;
ALTER TABLE "sms_outbox" ADD COLUMN "status" text DEFAULT 'queued' NOT NULL;
ALTER TABLE "sms_outbox" ADD COLUMN "status_detail" text;
