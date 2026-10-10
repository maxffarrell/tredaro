ALTER TABLE "charge" ADD COLUMN "disputed_at" timestamp with time zone;
ALTER TABLE "charge" ADD COLUMN "dispute_note" text;
