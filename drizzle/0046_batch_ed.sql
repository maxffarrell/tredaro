alter table "customer" add column "saved_card_provider" text;
alter table "customer" add column "saved_card_customer" text;
alter table "customer" add column "saved_card_ref" text;
alter table "customer" add column "saved_card_label" text;
alter table "purchase_order_item" add column "received_qty" integer not null default 0;
