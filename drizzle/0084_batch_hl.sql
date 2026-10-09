ALTER TABLE "customer" ADD COLUMN "do_not_service" boolean DEFAULT false NOT NULL;
ALTER TABLE "job_type" ADD COLUMN "requires_helper" boolean DEFAULT false NOT NULL;
