-- QA r58 (I-1): a contagem cega nasce LIGADA. A regra gravada antes só pelo modo do caixa (Configurações › Caixa grava as regras inteiras,
-- com os padrões de então) passa a ter a contagem cega ligada. Se a gestão já escolheu em Caixas da equipe (auditoria "caixa_regras"),
-- a escolha fica. O caixa do CRM ainda está desligado em produção.
UPDATE "settings" SET "value" = jsonb_set("value", '{contagemCega}', 'true'::jsonb, true), "updated_at" = now()
WHERE "key" = 'caixa_regras' AND jsonb_typeof("value") = 'object'
  AND NOT EXISTS (SELECT 1 FROM "audit_log" WHERE "action" = 'caixa_regras');
