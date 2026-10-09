create table if not exists "customer_document" (
	"id" text primary key,
	"organization_id" text not null references "organization"("id") on delete cascade,
	"customer_id" text not null references "customer"("id") on delete cascade,
	"uploaded_by_id" text references "member"("id") on delete set null,
	"file_name" text not null,
	"mime" text not null,
	"size" integer not null,
	"path" text not null,
	"created_at" timestamp with time zone not null default now(),
	"updated_at" timestamp with time zone not null default now()
);
--> statement-breakpoint
create index if not exists "customer_document_customer_idx" on "customer_document" ("customer_id");
