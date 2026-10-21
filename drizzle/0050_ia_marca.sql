-- IA marca (17/10): o horário que a sugestão propôs (para o "Marcar este horário") e a regra "A IA oferece só com" do serviço. Só acrescenta.
ALTER TABLE "ai_suggestions" ADD COLUMN "horario" jsonb;--> statement-breakpoint
ALTER TABLE "lists" ADD COLUMN "ai_pro_ids" uuid[];--> statement-breakpoint
ALTER TABLE "lists" ADD COLUMN "ai_pro_scope" text;--> statement-breakpoint
-- Dados (pedido do dono): a AVALIAÇÃO, quando o assunto é o Método Fiaes, a IA só oferece com a Thaise. Só onde ainda não há regra;
-- não mexe em quem faz o serviço (professional_services) nem apaga nada. Sem serviço de avaliação ou sem Thaise ativa: não faz nada.
UPDATE "lists" SET
  "ai_pro_ids" = (SELECT array_agg(p."id" ORDER BY p."agenda_position" NULLS LAST, p."name") FROM "professionals" p WHERE p."active" AND translate(lower(split_part(trim(p."name"), ' ', 1)), 'í', 'i') = 'thaise'),
  "ai_pro_scope" = 'metodo'
WHERE "kind" = 'service' AND "ai_pro_ids" IS NULL
  AND (translate(lower(trim("label")), 'çãâáàéêíóôõú', 'caaaaeeiooou') = 'avaliacao' OR translate(lower(trim("label")), 'çãâáàéêíóôõú', 'caaaaeeiooou') LIKE 'avaliacao%metodo%')
  AND EXISTS (SELECT 1 FROM "professionals" p WHERE p."active" AND translate(lower(split_part(trim(p."name"), ' ', 1)), 'í', 'i') = 'thaise');
