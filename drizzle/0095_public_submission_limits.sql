CREATE TABLE "public_submission_limit" (
 "key" text PRIMARY KEY NOT NULL,
 "hits" integer NOT NULL,
 "expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "public_submission_limit_expiry_idx" ON "public_submission_limit" ("expires_at");
