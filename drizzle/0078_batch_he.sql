alter table "job_time_entry" add column "locked_at" timestamp with time zone;
alter table "purchase_order" add column "job_id" text;
alter table "purchase_order" add constraint "purchase_order_job_id_job_id_fk" foreign key ("job_id") references "job"("id") on delete set null;
alter table "member" add column "license_no" text not null default '';
alter table "member" add column "license_expiry" date;
