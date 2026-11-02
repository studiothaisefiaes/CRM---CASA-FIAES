-- Agenda mais rápida (02/11): índices pequenos e parciais para três consultas da /agenda que liam a tabela inteira. Só aditivo e idempotente.
-- Sem CONCURRENTLY (o migrador do Drizzle roda em transação, ver 0009); parciais, então a construção é curta.
-- "Já pagaram" (countPaidNotUsed): o crédito do Avec procurava "credito cliente" em todos os pagamentos do Avec. O predicado é o mesmo texto da consulta (paid.ts).
CREATE INDEX IF NOT EXISTS "sales_payments_credito_cliente_idx" ON "sales_payments" USING btree ("contact_id") WHERE "contact_id" IS NOT NULL AND translate(lower("method"), 'áéíóúâêôãõç', 'aeiouaeoaoc') like '%credito cliente%';--> statement-breakpoint
-- Leads com horário (getAgenda): deals não tinha índice em scheduled_at.
CREATE INDEX IF NOT EXISTS "deals_scheduled_live_idx" ON "deals" USING btree ("scheduled_at") WHERE "scheduled_at" IS NOT NULL AND "archived_at" IS NULL;--> statement-breakpoint
-- "Pedidos do site" (listOnlineRequests) e a expiração do worker: status = 'solicitado' varria todos os horários.
CREATE INDEX IF NOT EXISTS "appointments_solicitado_idx" ON "appointments" USING btree ("starts_at") WHERE "status" = 'solicitado';
