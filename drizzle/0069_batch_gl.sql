alter table "job" add column if not exists "tags" text[];
alter table "webhook_delivery" add column if not exists "payload" text;
