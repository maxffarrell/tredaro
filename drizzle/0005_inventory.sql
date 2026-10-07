CREATE TABLE IF NOT EXISTS "inventory_item" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"sku" text DEFAULT '' NOT NULL,
	"unit" text DEFAULT 'each' NOT NULL,
	"qty_on_hand" integer DEFAULT 0 NOT NULL,
	"reorder_point" integer,
	"unit_cost" integer DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_item_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_material" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"job_id" text NOT NULL,
	"inventory_item_id" text NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"unit_price" integer DEFAULT 0 NOT NULL,
	"member_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_material_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade,
	CONSTRAINT "job_material_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE cascade,
	CONSTRAINT "job_material_inventory_item_id_inventory_item_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_item"("id") ON DELETE restrict,
	CONSTRAINT "job_material_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_item_org_idx" ON "inventory_item" ("organization_id","name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_material_job_idx" ON "job_material" ("job_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_material_item_idx" ON "job_material" ("organization_id","inventory_item_id");
