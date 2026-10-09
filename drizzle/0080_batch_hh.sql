create table "job_type_material" (
	"id" text primary key,
	"organization_id" text not null,
	"job_type_id" text not null,
	"inventory_item_id" text not null,
	"qty" integer not null default 1,
	"created_at" timestamp with time zone default now() not null,
	"updated_at" timestamp with time zone default now() not null
);
alter table "job_type_material" add constraint "job_type_material_organization_id_organization_id_fk" foreign key ("organization_id") references "organization"("id") on delete cascade;
alter table "job_type_material" add constraint "job_type_material_job_type_id_job_type_id_fk" foreign key ("job_type_id") references "job_type"("id") on delete cascade;
alter table "job_type_material" add constraint "job_type_material_inventory_item_id_inventory_item_id_fk" foreign key ("inventory_item_id") references "inventory_item"("id") on delete cascade;
create unique index "job_type_material_type_item_idx" on "job_type_material" ("job_type_id", "inventory_item_id");
create index "job_type_material_org_idx" on "job_type_material" ("organization_id");
