-- "Escrever com IA" no Retomar/Programar mensagem: o uso entra no gasto do mês sem conversa nem mensagem ligadas. Só afrouxa (o código antigo continua gravando os dois).
ALTER TABLE "ai_suggestions" ALTER COLUMN "deal_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_suggestions" ALTER COLUMN "last_message_id" DROP NOT NULL;