-- 17/10 (pedido do dono): profissional assistente de outra (SIDNEY é assistente de THAISE). Para a cliente, quem atende é a principal.
-- Só acrescenta a coluna; o vínculo é preenchido pela gestão em Configurações › Profissionais (nunca por migration).
ALTER TABLE "professionals" ADD COLUMN IF NOT EXISTS "assistant_of" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "professionals" ADD CONSTRAINT "professionals_assistant_of_professionals_id_fk" FOREIGN KEY ("assistant_of") REFERENCES "public"."professionals"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
ALTER TABLE "professionals" DROP CONSTRAINT IF EXISTS "professionals_assistant_not_self_ck";--> statement-breakpoint
ALTER TABLE "professionals" ADD CONSTRAINT "professionals_assistant_not_self_ck" CHECK ("assistant_of" is null or "assistant_of" <> "id");
