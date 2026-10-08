ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "on_hold" boolean DEFAULT false NOT NULL;
