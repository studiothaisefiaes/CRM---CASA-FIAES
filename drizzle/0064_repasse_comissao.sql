-- Fase A: pagamento da comissão com recibo numerado. Só acrescenta.
ALTER TABLE "professionals" ADD COLUMN IF NOT EXISTS "payout_period" text DEFAULT 'mensal' NOT NULL;--> statement-breakpoint
ALTER TABLE "professionals" DROP CONSTRAINT IF EXISTS "professionals_payout_period_ck";--> statement-breakpoint
ALTER TABLE "professionals" ADD CONSTRAINT "professionals_payout_period_ck" CHECK ("payout_period" IN ('mensal', 'quinzenal', 'semanal'));--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS "commission_payouts_number_seq";--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "commission_payouts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "number" integer DEFAULT nextval('commission_payouts_number_seq') NOT NULL,
  "professional_id" uuid NOT NULL REFERENCES "professionals"("id"),
  "from_day" date,
  "until_day" date NOT NULL,
  "commission_cents" integer DEFAULT 0 NOT NULL,
  "bonus_cents" integer DEFAULT 0 NOT NULL,
  "vales_cents" integer DEFAULT 0 NOT NULL,
  "descontos_cents" integer DEFAULT 0 NOT NULL,
  "carried_cents" integer DEFAULT 0 NOT NULL,
  "net_cents" integer DEFAULT 0 NOT NULL,
  "note" text,
  "paid_by" uuid NOT NULL REFERENCES "users"("id"),
  "paid_at" timestamp with time zone DEFAULT now() NOT NULL,
  "cancelled_at" timestamp with time zone,
  "cancelled_by" uuid REFERENCES "users"("id"),
  "cancel_reason" text
);--> statement-breakpoint
ALTER SEQUENCE "commission_payouts_number_seq" OWNED BY "commission_payouts"."number";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "commission_payouts_number_uq" ON "commission_payouts" USING btree ("number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commission_payouts_pro_idx" ON "commission_payouts" USING btree ("professional_id", "until_day");--> statement-breakpoint
ALTER TABLE "comanda_items" ADD COLUMN IF NOT EXISTS "payout_id" uuid REFERENCES "commission_payouts"("id");--> statement-breakpoint
ALTER TABLE "comanda_item_assistants" ADD COLUMN IF NOT EXISTS "payout_id" uuid REFERENCES "commission_payouts"("id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comanda_items_payout_idx" ON "comanda_items" USING btree ("payout_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comanda_item_assistants_payout_idx" ON "comanda_item_assistants" USING btree ("payout_id");
