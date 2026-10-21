-- Fase D: Produtos e estoque (item 29). Só acrescenta.
CREATE TABLE IF NOT EXISTS "products" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "brand" text,
  "category" text,
  "barcode" text,
  "ncm" text,
  "cfop" text DEFAULT '5102' NOT NULL,
  "csosn" text DEFAULT '102' NOT NULL,
  "unit" text DEFAULT 'UN' NOT NULL,
  "price_cents" integer,
  "cost_cents" integer,
  "use" text DEFAULT 'venda' NOT NULL,
  "min_qty" numeric,
  "avec_name" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "products_ncm_ck" CHECK ("ncm" is null or "ncm" ~ '^[0-9]{8}$'),
  CONSTRAINT "products_use_ck" CHECK ("use" in ('venda', 'consumo'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "products_name_uq" ON "products" USING btree (lower("name"));--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stock_movements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "product_id" uuid NOT NULL REFERENCES "products"("id"),
  "delta_qty" numeric NOT NULL,
  "reason" text NOT NULL,
  "comanda_item_id" uuid REFERENCES "comanda_items"("id"),
  "unit_cost_cents" integer,
  "note" text,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "cancelled_at" timestamp with time zone,
  CONSTRAINT "stock_movements_delta_ck" CHECK ("delta_qty" <> 0),
  CONSTRAINT "stock_movements_reason_ck" CHECK ("reason" in ('venda', 'entrada', 'saida', 'ajuste', 'saldo_avec'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_movements_product_idx" ON "stock_movements" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stock_movements_sale_uq" ON "stock_movements" USING btree ("comanda_item_id") WHERE "reason" = 'venda';--> statement-breakpoint
ALTER TABLE "comanda_items" ADD COLUMN IF NOT EXISTS "product_id" uuid REFERENCES "products"("id");--> statement-breakpoint
UPDATE "profiles" SET "permissions" = array_append("permissions", 'estoque.produtos') WHERE "key" = 'gestao' AND NOT 'estoque.produtos' = ANY("permissions");--> statement-breakpoint
UPDATE "profiles" SET "permissions" = array_append("permissions", 'estoque.movimentar') WHERE "key" = 'gestao' AND NOT 'estoque.movimentar' = ANY("permissions");
