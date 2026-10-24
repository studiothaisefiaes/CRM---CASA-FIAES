-- 23/10 (plano de melhorias, infra): buscas por id do WhatsApp sem o canal (reação, edição, apagada, ligação, enquete) não usavam o
-- messages_external_uq (que começa pelo canal); o worker procura os eventos pendentes; a reconciliação procura o evento pelo id da mensagem.
CREATE INDEX IF NOT EXISTS "messages_external_idx" ON "messages" ("external_id") WHERE "external_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_events_pending_idx" ON "webhook_events" ("received_at") WHERE "processed_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_events_key_id_idx" ON "webhook_events" (("payload" #>> '{data,key,id}'));
