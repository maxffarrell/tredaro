alter table "equipment" add column if not exists "photo_path" text;
alter table "equipment" add column if not exists "photo_mime" text;
create table if not exists "webhook_delivery" (
	"id" text primary key,
	"organization_id" text not null,
	"webhook_id" text not null,
	"event_type" text not null,
	"status" integer not null,
	"created_at" timestamp with time zone not null default now(),
	"updated_at" timestamp with time zone not null default now()
);
create index if not exists "webhook_delivery_hook_idx" on "webhook_delivery" ("webhook_id");
create index if not exists "webhook_delivery_org_idx" on "webhook_delivery" ("organization_id");
