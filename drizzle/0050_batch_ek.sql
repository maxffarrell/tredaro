alter table "job_type" add column "require_signature" boolean not null default false;--> statement-breakpoint
alter table "job" add column "warranty" boolean not null default false;--> statement-breakpoint
alter table "inventory_item" add column "location" text not null default '';
