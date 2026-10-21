-- Caixa: cancelar com motivo (caixa.cancelar) e a escolha da nota fiscal na comanda.
-- "Para nada mudar no dia": quem já operava o caixa (e descartava comanda) continua podendo cancelar.
UPDATE "profiles" SET "permissions" = array_append("permissions", 'caixa.cancelar') WHERE 'caixa.operar' = ANY("permissions") AND NOT ('caixa.cancelar' = ANY("permissions"));--> statement-breakpoint
ALTER TABLE "comandas" ADD COLUMN IF NOT EXISTS "nota_escolha" text;--> statement-breakpoint
ALTER TABLE "comandas" ADD CONSTRAINT "comandas_nota_escolha_ck" CHECK ("nota_escolha" is null or "nota_escolha" in ('nao', 'sem_cpf', 'com_cpf'));
