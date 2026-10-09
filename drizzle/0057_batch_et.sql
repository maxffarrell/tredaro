alter table "company_settings" add column if not exists "logo_url" text not null default '';
alter table "estimate" add column if not exists "internal_notes" text not null default '';
