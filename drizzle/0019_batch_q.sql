ALTER TABLE "payment" ADD COLUMN IF NOT EXISTS "refunded_at" timestamptz;
