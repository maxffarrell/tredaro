alter table "pricebook_item" add column "taxable" boolean not null default true;--> statement-breakpoint
alter table "inventory_item" add column "supplier_sku" text not null default '';
