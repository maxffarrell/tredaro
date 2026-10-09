alter table "company_settings" add column if not exists "auto_send_report" boolean not null default false;
