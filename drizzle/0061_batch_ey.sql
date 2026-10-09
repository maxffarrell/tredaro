create table if not exists "follow_up" (
	"id" text primary key,
	"organization_id" text not null references "organization"("id") on delete cascade,
	"member_id" text not null references "member"("id") on delete cascade,
	"customer_id" text references "customer"("id") on delete cascade,
	"job_id" text references "job"("id") on delete cascade,
	"note" text not null,
	"due_on" date not null,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone not null default now(),
	"updated_at" timestamp with time zone not null default now()
);
--> statement-breakpoint
create index if not exists "follow_up_member_due_idx" on "follow_up" ("member_id","due_on");
--> statement-breakpoint
create index if not exists "follow_up_customer_idx" on "follow_up" ("customer_id");
--> statement-breakpoint
create index if not exists "follow_up_job_idx" on "follow_up" ("job_id");
--> statement-breakpoint
create table if not exists "member_day_note" (
	"id" text primary key,
	"organization_id" text not null references "organization"("id") on delete cascade,
	"member_id" text not null references "member"("id") on delete cascade,
	"on" date not null,
	"note" text not null,
	"created_at" timestamp with time zone not null default now(),
	"updated_at" timestamp with time zone not null default now()
);
--> statement-breakpoint
create unique index if not exists "member_day_note_member_on_idx" on "member_day_note" ("member_id","on");
