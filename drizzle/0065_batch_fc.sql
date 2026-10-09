alter table "member_time_off" add column if not exists "status" text not null default 'approved';
alter table "job_event" add column if not exists "lat" double precision;
alter table "job_event" add column if not exists "lng" double precision;
