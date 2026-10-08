ALTER TABLE "job_type" ADD COLUMN IF NOT EXISTS "require_checklist" boolean DEFAULT false NOT NULL;
ALTER TABLE "job_type" ADD COLUMN IF NOT EXISTS "require_photo" boolean DEFAULT false NOT NULL;
