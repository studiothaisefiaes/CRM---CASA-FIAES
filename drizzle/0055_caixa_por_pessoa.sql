-- Plano 3 (17/10): caixa POR PESSOA e pagamento novo (modelo do Norte Vendas, sem taxa de serviço). Só acrescenta, menos o índice
-- "um caixa aberto na Casa", que vira "um caixa aberto por pessoa".
DROP INDEX IF EXISTS "cash_sessions_one_open";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cash_sessions_one_open_per_person" ON "cash_sessions" USING btree ("opened_by") WHERE "status" = 'aberto';--> statement-breakpoint
-- Fechamento: dinheiro contado por cédula e moeda ({"20000": 2, ...} = centavos da cédula → quantidade), aprovação da gestão e contagem cega.
ALTER TABLE "cash_sessions" ADD COLUMN IF NOT EXISTS "counted_breakdown" jsonb;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD COLUMN IF NOT EXISTS "approved_by" uuid REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD COLUMN IF NOT EXISTS "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD COLUMN IF NOT EXISTS "blind" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- "Outra forma" de pagamento, cadastrada pela gestão (Serviços e pacotes › Formas de pagamento).
CREATE TABLE IF NOT EXISTS "payment_method_options" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "label" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_method_options_label_uq" ON "payment_method_options" USING btree (lower("label"));--> statement-breakpoint
-- Pagamento: em que caixa entrou, bandeira, observação, qual "outra forma", o troco devolvido dele e o estorno.
ALTER TABLE "comanda_payments" ADD COLUMN IF NOT EXISTS "cash_session_id" uuid REFERENCES "cash_sessions"("id");--> statement-breakpoint
ALTER TABLE "comanda_payments" ADD COLUMN IF NOT EXISTS "brand" text;--> statement-breakpoint
ALTER TABLE "comanda_payments" ADD COLUMN IF NOT EXISTS "note" text;--> statement-breakpoint
ALTER TABLE "comanda_payments" ADD COLUMN IF NOT EXISTS "custom_method_id" uuid REFERENCES "payment_method_options"("id");--> statement-breakpoint
ALTER TABLE "comanda_payments" ADD COLUMN IF NOT EXISTS "change_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "comanda_payments" ADD COLUMN IF NOT EXISTS "cancelled_by" uuid REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "comanda_payments" ADD COLUMN IF NOT EXISTS "cancel_reason" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comanda_payments_session_idx" ON "comanda_payments" USING btree ("cash_session_id");--> statement-breakpoint
-- NOT VALID: vale para o que entrar daqui para a frente (o caixa do CRM ainda está desligado em produção).
ALTER TABLE "comanda_payments" DROP CONSTRAINT IF EXISTS "comanda_payments_brand_ck";--> statement-breakpoint
ALTER TABLE "comanda_payments" ADD CONSTRAINT "comanda_payments_brand_ck" CHECK ("method" NOT IN ('credito', 'debito') OR "brand" IS NOT NULL) NOT VALID;--> statement-breakpoint
ALTER TABLE "comanda_payments" DROP CONSTRAINT IF EXISTS "comanda_payments_outra_ck";--> statement-breakpoint
ALTER TABLE "comanda_payments" ADD CONSTRAINT "comanda_payments_outra_ck" CHECK ("method" <> 'outra' OR "custom_method_id" IS NOT NULL) NOT VALID;--> statement-breakpoint
ALTER TABLE "comanda_payments" DROP CONSTRAINT IF EXISTS "comanda_payments_change_ck";--> statement-breakpoint
ALTER TABLE "comanda_payments" ADD CONSTRAINT "comanda_payments_change_ck" CHECK ("change_cents" >= 0 AND "change_cents" <= "value_cents");--> statement-breakpoint
-- Item: preço do catálogo (o anterior), motivo do preço e do desconto, e o tipo para a nota (serviço = NFS-e, produto = NFC-e).
ALTER TABLE "comanda_items" ADD COLUMN IF NOT EXISTS "original_unit_cents" integer;--> statement-breakpoint
ALTER TABLE "comanda_items" ADD COLUMN IF NOT EXISTS "price_reason" text;--> statement-breakpoint
ALTER TABLE "comanda_items" ADD COLUMN IF NOT EXISTS "discount_reason" text;--> statement-breakpoint
ALTER TABLE "comanda_items" ADD COLUMN IF NOT EXISTS "fiscal_kind" text DEFAULT 'servico' NOT NULL;--> statement-breakpoint
UPDATE "comanda_items" SET "fiscal_kind" = 'produto' WHERE "kind" = 'produto' AND "fiscal_kind" <> 'produto';--> statement-breakpoint
ALTER TABLE "comanda_items" DROP CONSTRAINT IF EXISTS "comanda_items_fiscal_kind_ck";--> statement-breakpoint
ALTER TABLE "comanda_items" ADD CONSTRAINT "comanda_items_fiscal_kind_ck" CHECK ("fiscal_kind" IN ('servico', 'produto'));--> statement-breakpoint
-- Comanda: CPF na nota (opcional), motivo do desconto e a reabertura.
ALTER TABLE "comandas" ADD COLUMN IF NOT EXISTS "cpf" text;--> statement-breakpoint
ALTER TABLE "comandas" ADD COLUMN IF NOT EXISTS "discount_reason" text;--> statement-breakpoint
ALTER TABLE "comandas" ADD COLUMN IF NOT EXISTS "reopened_by" uuid REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "comandas" ADD COLUMN IF NOT EXISTS "reopened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "comandas" ADD COLUMN IF NOT EXISTS "reopen_reason" text;--> statement-breakpoint
ALTER TABLE "comandas" DROP CONSTRAINT IF EXISTS "comandas_cpf_ck";--> statement-breakpoint
ALTER TABLE "comandas" ADD CONSTRAINT "comandas_cpf_ck" CHECK ("cpf" IS NULL OR "cpf" ~ '^[0-9]{11}$');--> statement-breakpoint
-- Dados: o pagamento das comandas já fechadas entra no caixa em que a comanda fechou, e o troco da comanda vai para o último dinheiro dela.
UPDATE "comanda_payments" p SET "cash_session_id" = c."cash_session_id" FROM "comandas" c
  WHERE c."id" = p."comanda_id" AND p."cash_session_id" IS NULL AND c."cash_session_id" IS NOT NULL;--> statement-breakpoint
UPDATE "comanda_payments" p SET "change_cents" = LEAST(c."change_cents", p."value_cents")
  FROM "comandas" c,
  (SELECT DISTINCT ON ("comanda_id") "id", "comanda_id" FROM "comanda_payments" WHERE "method" = 'dinheiro' AND "cancelled_at" IS NULL ORDER BY "comanda_id", "created_at" DESC) last
  WHERE last."id" = p."id" AND c."id" = last."comanda_id" AND c."status" = 'fechada' AND COALESCE(c."change_cents", 0) > 0 AND p."change_cents" = 0;
