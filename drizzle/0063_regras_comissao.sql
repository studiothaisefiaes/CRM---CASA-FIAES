-- Fase A: regras da comissão (da Casa e, se quiser, de cada profissional), custo do serviço e o retrato dos descontos no item.
ALTER TABLE "professionals" ADD COLUMN IF NOT EXISTS "commission_rules" jsonb;--> statement-breakpoint
ALTER TABLE "lists" ADD COLUMN IF NOT EXISTS "cost_cents" integer;--> statement-breakpoint
ALTER TABLE "lists" DROP CONSTRAINT IF EXISTS "lists_cost_ck";--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_cost_ck" CHECK ("cost_cents" IS NULL OR "cost_cents" >= 0);--> statement-breakpoint
ALTER TABLE "comanda_items" ADD COLUMN IF NOT EXISTS "commission_gross_cents" integer;--> statement-breakpoint
ALTER TABLE "comanda_items" ADD COLUMN IF NOT EXISTS "commission_deductions" jsonb;--> statement-breakpoint
-- Regras da Casa (decisão 6 do plano); o código usa o neutro quando a linha não existe.
INSERT INTO "settings" ("key", "value") VALUES ('comissao_regras', '{"cartao":"antes","antecipacao":"antes","antecipacaoBp":700,"custo":"depois","doisAssistentes":"metade","assistenteSaiDaPrincipalBp":10000,"divida":"quitacao"}'::jsonb)
ON CONFLICT ("key") DO NOTHING;
