-- "Apagar só aqui" (20/10): a Casa tira uma mensagem da conversa no CRM sem mexer no WhatsApp da cliente.
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "hidden_at" timestamp with time zone;
