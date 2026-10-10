-- Índices para relatórios por período, fila e busca. Só aditivo e idempotente (IF NOT EXISTS).
-- Sem CONCURRENTLY de propósito: o migrador do Drizzle roda a migração dentro de uma transação, e CREATE INDEX CONCURRENTLY não roda em transação.
-- A criação segura os bloqueios de escrita só enquanto constrói (tabelas pequenas desta casa: segundos).
CREATE INDEX IF NOT EXISTS "deals_created_at_idx" ON "deals" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deals_closed_at_idx" ON "deals" USING btree ("closed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_created_at_idx" ON "messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_contact_created_idx" ON "messages" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_deal_idx" ON "tasks" USING btree ("deal_id");--> statement-breakpoint
-- Busca por trecho do telefone (LIKE '%9988%'). Fora do schema do Drizzle, como os outros índices trigram da 0008 (pg_trgm já criada lá).
CREATE INDEX IF NOT EXISTS contacts_phone_trgm ON contacts USING gin (phone_e164 gin_trgm_ops);
