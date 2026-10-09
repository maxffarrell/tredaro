create table "job_document" (
	"id" text primary key,
	"organization_id" text not null,
	"job_id" text not null,
	"uploaded_by_id" text,
	"file_name" text not null,
	"mime" text not null,
	"size" integer not null,
	"path" text not null,
	"created_at" timestamp with time zone default now() not null,
	"updated_at" timestamp with time zone default now() not null
);
alter table "job_document" add constraint "job_document_organization_id_organization_id_fk" foreign key ("organization_id") references "organization"("id") on delete cascade;
alter table "job_document" add constraint "job_document_job_id_job_id_fk" foreign key ("job_id") references "job"("id") on delete cascade;
alter table "job_document" add constraint "job_document_uploaded_by_id_member_id_fk" foreign key ("uploaded_by_id") references "member"("id") on delete set null;
create index "job_document_job_idx" on "job_document" ("job_id");
