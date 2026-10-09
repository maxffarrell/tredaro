alter table "job" add column "depends_on_job_id" text;
alter table "job" add constraint "job_depends_on_job_id_job_id_fk" foreign key ("depends_on_job_id") references "public"."job"("id") on delete set null on update no action;
alter table "estimate" add column "job_type_id" text;
alter table "estimate" add constraint "estimate_job_type_id_job_type_id_fk" foreign key ("job_type_id") references "public"."job_type"("id") on delete set null on update no action;
alter table "pricebook_item" add column "job_type_id" text;
alter table "pricebook_item" add constraint "pricebook_item_job_type_id_job_type_id_fk" foreign key ("job_type_id") references "public"."job_type"("id") on delete set null on update no action;
