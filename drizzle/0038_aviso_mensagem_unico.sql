-- Antes do índice único: se já houver mais de um aviso "a cliente escreveu" aberto na mesma conversa, fica só o mais novo.
UPDATE "alerts" a SET "resolved_at" = now() WHERE a."type" = 'mensagem_cliente' AND a."resolved_at" IS NULL AND EXISTS (
  SELECT 1 FROM "alerts" b WHERE b."deal_id" = a."deal_id" AND b."type" = 'mensagem_cliente' AND b."resolved_at" IS NULL AND (b."created_at", b."id") > (a."created_at", a."id"));--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_mensagem_cliente_aberto_uq" ON "alerts" USING btree ("deal_id") WHERE type = 'mensagem_cliente' and resolved_at is null;
