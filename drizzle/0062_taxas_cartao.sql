-- Fase A: taxa do cartão por forma, bandeira e parcelado. A taxa de cada pagamento é um retrato do momento (fee_bp/fee_cents);
-- vazio = não é cartão ou a bandeira estava sem taxa cadastrada.
CREATE TABLE IF NOT EXISTS "payment_fees" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "method" text NOT NULL,
  "brand" text NOT NULL,
  "parcelado" boolean DEFAULT false NOT NULL,
  "fee_bp" integer NOT NULL,
  "updated_by" uuid REFERENCES "users"("id"),
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "payment_fees_method_ck" CHECK ("method" IN ('credito', 'debito')),
  CONSTRAINT "payment_fees_parcelado_ck" CHECK ("method" = 'credito' OR NOT "parcelado"),
  CONSTRAINT "payment_fees_bp_ck" CHECK ("fee_bp" BETWEEN 0 AND 10000)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_fees_uq" ON "payment_fees" USING btree ("method", "brand", "parcelado");--> statement-breakpoint
ALTER TABLE "comanda_payments" ADD COLUMN IF NOT EXISTS "fee_bp" integer;--> statement-breakpoint
ALTER TABLE "comanda_payments" ADD COLUMN IF NOT EXISTS "fee_cents" integer;--> statement-breakpoint
ALTER TABLE "comanda_payments" DROP CONSTRAINT IF EXISTS "comanda_payments_fee_ck";--> statement-breakpoint
ALTER TABLE "comanda_payments" ADD CONSTRAINT "comanda_payments_fee_ck" CHECK ("fee_cents" IS NULL OR ("fee_cents" >= 0 AND "fee_cents" <= "value_cents"));--> statement-breakpoint
-- Taxas da Casa: débito 1,99% (Visa, Mastercard, Elo); crédito à vista por bandeira; crédito parcelado (2x a 12x) 5,70% nas 5 bandeiras.
INSERT INTO "payment_fees" ("method", "brand", "parcelado", "fee_bp") VALUES
  ('debito', 'visa', false, 199), ('debito', 'mastercard', false, 199), ('debito', 'elo', false, 199),
  ('credito', 'visa', false, 243), ('credito', 'mastercard', false, 210), ('credito', 'elo', false, 290),
  ('credito', 'hipercard', false, 300), ('credito', 'amex', false, 290),
  ('credito', 'visa', true, 570), ('credito', 'mastercard', true, 570), ('credito', 'elo', true, 570),
  ('credito', 'hipercard', true, 570), ('credito', 'amex', true, 570)
ON CONFLICT ("method", "brand", "parcelado") DO NOTHING;
