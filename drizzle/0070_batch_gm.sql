alter table "company_settings" add column if not exists "booking_review" boolean not null default false;
alter table "company_settings" add column if not exists "booking_blackouts" text not null default '';
alter table "company_settings" add column if not exists "reminder_hours" integer not null default 36;
alter table "job" add column if not exists "needs_review" boolean not null default false;
