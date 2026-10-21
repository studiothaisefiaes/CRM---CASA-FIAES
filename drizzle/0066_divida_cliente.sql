-- Fase A: dívida da cliente (por comanda). Só acrescenta. A dívida e o crédito do Avec ficam no Avec.
ALTER TABLE "comandas" ADD COLUMN IF NOT EXISTS "debt_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "comandas" DROP CONSTRAINT IF EXISTS "comandas_debt_ck";--> statement-breakpoint
ALTER TABLE "comandas" ADD CONSTRAINT "comandas_debt_ck" CHECK ("debt_cents" >= 0);--> statement-breakpoint
-- Quitar = item "Dívida da comanda N" (kind = 'divida') numa comanda nova; com a regra "quando ela pagar", a comissão fica retida até zerar.
ALTER TABLE "comanda_items" ADD COLUMN IF NOT EXISTS "settles_comanda_id" uuid REFERENCES "comandas"("id");--> statement-breakpoint
ALTER TABLE "comanda_items" ADD COLUMN IF NOT EXISTS "commission_held" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_debt_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id"),
  "comanda_id" uuid NOT NULL REFERENCES "comandas"("id"),
  "delta_cents" integer NOT NULL,
  "paid_in_comanda_id" uuid REFERENCES "comandas"("id"),
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "client_debt_delta_ck" CHECK ("delta_cents" <> 0)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_debt_contact_idx" ON "client_debt_entries" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_debt_comanda_idx" ON "client_debt_entries" USING btree ("comanda_id");
