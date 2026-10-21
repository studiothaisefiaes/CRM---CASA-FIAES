-- Consentimento e Automáticas pausadas (Fase B, itens 13 e 14). Só acrescenta; ninguém é preenchido: todo mundo começa "não perguntado" (null).
--   consent_*: true = Sim, false = Não, null = não perguntado. consent_at/by: quem mudou por último.
--   automations_paused_until: null = automáticas valendo; data = pausadas até essa data; 'infinity' = até alguém religar.
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "consent_whatsapp" boolean;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "consent_ai" boolean;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "consent_cpf_nota" boolean;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "consent_by" uuid;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "automations_paused_until" timestamp with time zone;
