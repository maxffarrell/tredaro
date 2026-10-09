alter table "customer" add column "tax_rate_bps" integer;
alter table "company_settings" add column "booking_deposit" integer not null default 0;
