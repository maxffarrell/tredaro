alter table "job_type" add column if not exists "bookable" boolean not null default true;
