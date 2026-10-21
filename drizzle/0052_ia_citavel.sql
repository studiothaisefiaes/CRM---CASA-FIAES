-- IA v3 (17/10): "A IA pode citar" no serviço. Só acrescenta (padrão sim: nada muda para quem não está na lista abaixo).
ALTER TABLE "lists" ADD COLUMN IF NOT EXISTS "ai_citavel" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- Dados (idempotente): serviços claramente internos ou sem especialista não vão para a lista da IA. Nome comparado sem acento, maiúscula
-- nem espaço sobrando. Só desliga (nunca liga de volta o que a gestão desligou), não desativa o serviço nem mexe na Agenda.
UPDATE "lists" SET "ai_citavel" = false
WHERE "kind" = 'service' AND "ai_citavel"
  AND (
    regexp_replace(translate(lower(trim("label")), 'çãâáàéêíóôõúü', 'caaaaeeiooouu'), '\s+', ' ', 'g') = 'servico'
    OR regexp_replace(translate(lower(trim("label")), 'çãâáàéêíóôõúü', 'caaaaeeiooouu'), '\s+', ' ', 'g') LIKE 'reuniao%'
    OR regexp_replace(translate(lower(trim("label")), 'çãâáàéêíóôõúü', 'caaaaeeiooouu'), '\s+', ' ', 'g') LIKE 'sessao de pacote%'
    OR regexp_replace(translate(lower(trim("label")), 'çãâáàéêíóôõúü', 'caaaaeeiooouu'), '\s+', ' ', 'g') LIKE 'cabelo metodo fiaes 1/2%'
    OR regexp_replace(translate(lower(trim("label")), 'çãâáàéêíóôõúü', 'caaaaeeiooouu'), '\s+', ' ', 'g') LIKE 'aplicacao metodo fiaes%'
    OR regexp_replace(translate(lower(trim("label")), 'çãâáàéêíóôõúü', 'caaaaeeiooouu'), '\s+', ' ', 'g') LIKE 'sobrancelha%'
  );
