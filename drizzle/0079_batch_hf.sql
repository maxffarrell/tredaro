alter table "purchase_order" add column "paid_at" timestamp with time zone;
--> statement-breakpoint
alter table "estimate" add column "decline_reason" text not null default '';
