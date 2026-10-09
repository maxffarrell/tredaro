alter table "member" add column if not exists "color" text not null default '';
alter table "estimate" add column if not exists "customer_po" text not null default '';
