alter table "job" add column "route_order" integer;
alter table "job_time_entry" add column "approved_at" timestamp with time zone;
alter table "job_time_entry" add column "approved_by_id" text;
