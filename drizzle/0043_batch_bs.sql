alter table "company_settings" add column if not exists "estimate_valid_days" integer not null default 30;
