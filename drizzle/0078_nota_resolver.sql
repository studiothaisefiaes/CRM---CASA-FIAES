-- Fase D, revisão final do branch.
-- I-3: Teste e Produção não se misturam na mesma comanda. A nota viva (pendente ou autorizada) passa a ser única por comanda, tipo E
-- ambiente: uma nota de Teste autorizada numa comanda real não impede a nota de Produção dela.
DROP INDEX IF EXISTS "fiscal_documents_live_uq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_documents_live_uq" ON "fiscal_documents" USING btree ("comanda_id", "kind", "environment") WHERE "status" in ('pendente', 'autorizada');--> statement-breakpoint
-- I-2: "Resolver nota fora do CRM" (nota.resolver), só a Gestão (o seed também dá, via GESTAO_REQUIRED). Idempotente.
UPDATE "profiles" SET "permissions" = array_append("permissions", 'nota.resolver') WHERE "key" = 'gestao' AND NOT 'nota.resolver' = ANY("permissions");
