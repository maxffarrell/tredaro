alter table "customer_document" add column if not exists "via_portal" boolean not null default false;
