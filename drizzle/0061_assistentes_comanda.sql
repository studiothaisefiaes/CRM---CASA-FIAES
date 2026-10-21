-- Fase A (18/10), assistente na comanda. Só acrescenta. O vínculo professionals.assistant_of NUNCA é preenchido por migration (regra da 0053).
-- "% da assistente": na linha da profissional principal × serviço, em pontos-base (1000 = 10%); vazio = assistente sem regra.
ALTER TABLE "professional_services" ADD COLUMN IF NOT EXISTS "assistant_bp" integer;--> statement-breakpoint
ALTER TABLE "professional_services" DROP CONSTRAINT IF EXISTS "professional_services_assistant_ck";--> statement-breakpoint
ALTER TABLE "professional_services" ADD CONSTRAINT "professional_services_assistant_ck" CHECK ("assistant_bp" BETWEEN 0 AND 10000);--> statement-breakpoint
-- Até 2 assistentes por item de serviço; guarda o retrato da comissão de cada uma ao Finalizar. payout_id (fk do recibo) vem na 0064.
CREATE TABLE IF NOT EXISTS "comanda_item_assistants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "comanda_item_id" uuid NOT NULL REFERENCES "comanda_items"("id") ON DELETE CASCADE,
  "professional_id" uuid NOT NULL REFERENCES "professionals"("id"),
  "position" smallint NOT NULL,
  "base_cents" integer,
  "bp" integer,
  "commission_cents" integer,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "comanda_item_assistants_position_ck" CHECK ("position" IN (1, 2))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "comanda_item_assistants_position_uq" ON "comanda_item_assistants" USING btree ("comanda_item_id", "position");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "comanda_item_assistants_pro_uq" ON "comanda_item_assistants" USING btree ("comanda_item_id", "professional_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comanda_item_assistants_pro_idx" ON "comanda_item_assistants" USING btree ("professional_id");
