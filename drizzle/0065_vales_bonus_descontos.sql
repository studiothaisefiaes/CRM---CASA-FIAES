-- Fase A: vale, bônus e desconto na comissão (avulsos ou "todo mês no dia X"). Só acrescenta.
CREATE TABLE IF NOT EXISTS "professional_adjustment_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "professional_id" uuid NOT NULL REFERENCES "professionals"("id"),
  "kind" text NOT NULL,
  "value_cents" integer NOT NULL,
  "day_of_month" smallint NOT NULL,
  "starts_on" date NOT NULL,
  "ends_on" date,
  "note" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "professional_adjustment_rules_kind_ck" CHECK ("kind" IN ('vale', 'bonus', 'desconto')),
  CONSTRAINT "professional_adjustment_rules_value_ck" CHECK ("value_cents" > 0),
  CONSTRAINT "professional_adjustment_rules_day_ck" CHECK ("day_of_month" BETWEEN 1 AND 28)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "professional_adjustment_rules_pro_idx" ON "professional_adjustment_rules" USING btree ("professional_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "professional_adjustments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "professional_id" uuid NOT NULL REFERENCES "professionals"("id"),
  "kind" text NOT NULL,
  "value_cents" integer NOT NULL,
  "day" date NOT NULL,
  "note" text NOT NULL,
  "rule_id" uuid REFERENCES "professional_adjustment_rules"("id"),
  "cash_movement_id" uuid REFERENCES "cash_movements"("id"),
  "carried_from_payout_id" uuid REFERENCES "commission_payouts"("id"),
  "payout_id" uuid REFERENCES "commission_payouts"("id"),
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "cancelled_at" timestamp with time zone,
  "cancelled_by" uuid REFERENCES "users"("id"),
  "cancel_reason" text,
  CONSTRAINT "professional_adjustments_kind_ck" CHECK ("kind" IN ('vale', 'bonus', 'desconto')),
  CONSTRAINT "professional_adjustments_value_ck" CHECK ("value_cents" > 0)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "professional_adjustments_pro_idx" ON "professional_adjustments" USING btree ("professional_id", "day");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "professional_adjustments_payout_idx" ON "professional_adjustments" USING btree ("payout_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "professional_adjustments_rule_day_uq" ON "professional_adjustments" USING btree ("rule_id", "day") WHERE "rule_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "professional_adjustments_movement_uq" ON "professional_adjustments" USING btree ("cash_movement_id") WHERE "cash_movement_id" IS NOT NULL;
