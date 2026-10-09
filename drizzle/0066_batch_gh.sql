alter table "estimate_item" add column if not exists "option_group" text not null default '';
alter table "estimate" add column if not exists "accepted_option" text;
alter table "estimate" add column if not exists "accepted_items" text[];
alter table "service_agreement" add column if not exists "auto_renew" boolean not null default false;
alter table "service_agreement" add column if not exists "terms_completed" integer not null default 0;
