DO $$ BEGIN
	CREATE TYPE "public"."po_status" AS ENUM('draft', 'ordered', 'received', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_order" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"number" integer NOT NULL,
	"supplier" text NOT NULL,
	"status" "po_status" DEFAULT 'draft' NOT NULL,
	"expected_on" date,
	"notes" text DEFAULT '' NOT NULL,
	"ordered_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_order_item" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"purchase_order_id" text NOT NULL,
	"inventory_item_id" text,
	"name" text NOT NULL,
	"unit" text DEFAULT 'each' NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"unit_cost" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_item_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade,
	CONSTRAINT "purchase_order_item_purchase_order_id_purchase_order_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_order"("id") ON DELETE cascade,
	CONSTRAINT "purchase_order_item_inventory_item_id_inventory_item_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_item"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_order_org_idx" ON "purchase_order" ("organization_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "po_item_po_idx" ON "purchase_order_item" ("purchase_order_id");
