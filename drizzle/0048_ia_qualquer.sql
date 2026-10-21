-- Sugestão a qualquer momento (16/10): o pedido (tema da atendente + mensagem citada) entra na chave da 1ª sugestão. Só acrescenta (o código antigo grava "").
DROP INDEX "ai_suggestions_auto_uq";--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD COLUMN "pedido" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_suggestions_auto_uq" ON "ai_suggestions" USING btree ("last_message_id","pedido") WHERE "ai_suggestions"."origin" = 'auto';