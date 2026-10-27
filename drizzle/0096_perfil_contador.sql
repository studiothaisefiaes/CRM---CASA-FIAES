-- Perfil Contador e link de convite aberto (pedido do dono, 26/10): "um perfil para o contador, um link onde ele coloca o e-mail e cria um
-- acesso para ele, sem ser de gerente".
-- Entrou como 0096 (26/10). A migration das campanhas de anúncio, que ainda não subiu, vira 0097 com `when` maior que o desta (1793100000000).
--
-- 1. open_invites: link de uso único (7 dias) amarrado a um perfil, sem e-mail. Nunca se guarda o link: só o sha256 do segredo
--    (`token_hash`, único), como o convite de sempre. Usar marca `used_at`/`used_by`; revogar marca `revoked_at`/`revoked_by`.
CREATE TABLE IF NOT EXISTS "open_invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "profile_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "used_at" timestamp with time zone,
  "used_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "revoked_at" timestamp with time zone,
  "revoked_by" uuid REFERENCES "users"("id") ON DELETE SET NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "open_invites_hash_uq" ON "open_invites" ("token_hash");--> statement-breakpoint
-- 2. relatorios.avec (permissão nova): quem já via os relatórios do Avec (ver Relatórios + toda a equipe + ver valores) continua vendo.
--    Roda antes de o Contador nascer e nunca dá para ele (que tem as três, mas só lê o dinheiro). A Gestão também ganha pelo seed.
UPDATE "profiles" SET "permissions" = array_append("permissions", 'relatorios.avec')
WHERE 'relatorios.ver' = ANY("permissions") AND 'relatorios.equipe' = ANY("permissions") AND 'valores.ver' = ANY("permissions")
  AND NOT ('relatorios.avec' = ANY("permissions")) AND "key" IS DISTINCT FROM 'contador';--> statement-breakpoint
-- 3. O perfil de sistema Contador (o mesmo de SYSTEM_PROFILES): só leitura do dinheiro e do fiscal. Se a gestão já tiver criado um perfil
--    com o nome "Contador", o de sistema nasce como "Contador (padrão)" (o nome é único); a gestão renomeia em Perfis se quiser.
INSERT INTO "profiles" ("key", "name", "permissions", "is_system")
SELECT 'contador',
  CASE WHEN EXISTS (SELECT 1 FROM "profiles" WHERE lower("name") = 'contador') THEN 'Contador (padrão)' ELSE 'Contador' END,
  ARRAY['relatorios.ver', 'relatorios.equipe', 'relatorios.exportar', 'valores.ver', 'relatorios.excecoes', 'comissao.ver', 'caixa.dinheiro', 'caixa.outros', 'nota.ver']::text[],
  true
WHERE NOT EXISTS (SELECT 1 FROM "profiles" WHERE "key" = 'contador');
