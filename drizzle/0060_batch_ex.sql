alter table "pricebook_item" add column if not exists "cost" integer not null default 0;
alter table "company_settings" add column if not exists "business_hours" text not null default '';
create table if not exists "customer_contact" (
	"id" text primary key,
	"organization_id" text not null references "organization"("id") on delete cascade,
	"customer_id" text not null references "customer"("id") on delete cascade,
	"name" text not null,
	"role" text not null default '',
	"email" text not null default '',
	"phone" text not null default '',
	"is_primary" boolean not null default false,
	"created_at" timestamp with time zone not null default now(),
	"updated_at" timestamp with time zone
);
create index if not exists "customer_contact_customer_idx" on "customer_contact" ("customer_id");
