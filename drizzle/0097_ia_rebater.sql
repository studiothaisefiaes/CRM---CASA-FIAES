-- Rebater a sugestão da IA e assistente quando atende junto (29/10).
-- Entrou como 0097 (29/10). A migration das campanhas de anúncio, que ainda não subiu, vira 0098 com `when` maior que o desta (1793300000000).
--
-- 1. ai_suggestions.critica: o que a atendente disse ao rebater ("faça mais curta, sem oferecer horário"). A sugestão nova sai com origin "outra".
ALTER TABLE "ai_suggestions" ADD COLUMN IF NOT EXISTS "critica" text;--> statement-breakpoint
-- 2. ai_licoes: o que a IA disse que errou ao ser rebatida, como regra para as próximas. Só vale depois que a gestão aprova
--    ("usar sempre" → status 'aprovada'); 'pendente' e 'descartada' nunca entram no pedido da IA. Sem dado de cliente (a IA escreve a regra geral).
CREATE TABLE IF NOT EXISTS "ai_licoes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "suggestion_id" uuid REFERENCES "ai_suggestions"("id") ON DELETE SET NULL,
  "critica" text NOT NULL,
  "licao" text NOT NULL,
  "status" text DEFAULT 'pendente' NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "decided_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "decided_at" timestamp with time zone
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_licoes_status_idx" ON "ai_licoes" ("status", "created_at");--> statement-breakpoint
-- 3. professionals.assists_with: profissional que atende em nome próprio mas entra como assistente de outra QUANDO as duas atendem a mesma
--    visita (Maiara com Thaise, Cati 27/10). Para a cliente (lembrete, link), o serviço dela aparece com a principal.
ALTER TABLE "professionals" ADD COLUMN IF NOT EXISTS "assists_with" uuid REFERENCES "professionals"("id") ON DELETE SET NULL;
