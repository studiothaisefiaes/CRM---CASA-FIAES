-- Sugestão da IA com retomada (Cati 17/10): a cliente cancelou sem nova data e a sugestão propõe QUANDO retomar o contato.
-- Vazio = sem proposta. Nada é criado aqui: a retomada só existe quando a atendente toca "Programar retomada". Só acrescenta; pode rodar 2 vezes.
ALTER TABLE "ai_suggestions" ADD COLUMN IF NOT EXISTS "retomar_em" timestamp with time zone;
