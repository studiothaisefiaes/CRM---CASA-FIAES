-- 18/10: o Avec deu sinal sobre o horário, mas a importação não teve certeza e não mexeu (vai para "Conferir com o Avec"). Só acrescenta.
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "avec_review" text;--> statement-breakpoint
-- O 0248 "Agendamentos por status › Agendado" (que entrava como lista de espera) vira sinal: a reserva continua Agendado no Avec, sem baixa.
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "avec_unclosed_at" timestamp with time zone;
