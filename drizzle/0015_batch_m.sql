ALTER TABLE "job_material" ADD COLUMN IF NOT EXISTS "source_member_id" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "truck_stock" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"member_id" text NOT NULL,
	"inventory_item_id" text NOT NULL,
	"qty" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "truck_stock" ADD CONSTRAINT "truck_stock_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "truck_stock" ADD CONSTRAINT "truck_stock_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "truck_stock" ADD CONSTRAINT "truck_stock_inventory_item_id_inventory_item_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_item"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "job_material" ADD CONSTRAINT "job_material_source_member_id_member_id_fk" FOREIGN KEY ("source_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "truck_stock_member_item_idx" ON "truck_stock" USING btree ("member_id","inventory_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "truck_stock_org_idx" ON "truck_stock" USING btree ("organization_id");
