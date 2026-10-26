-- API v1 (pedido do dono, 26/10): chaves para scripts e integrações puxarem e escreverem no CRM. A chave age EM NOME de uma pessoa da
-- equipe (`user_id`): valem as permissões do perfil dela E os escopos da chave (ler, escrever, enviar). Nunca se guarda a chave: só o
-- sha256 do segredo (`key_hash`) e os 8 primeiros caracteres (`prefix`) para reconhecer na lista. Revogar é marcar `revoked_at` (fica a
-- história na auditoria). A Gestão ganha a permissão nova `api.gerir` (o seed também dá, via GESTAO_REQUIRED). Pode rodar 2 vezes.
CREATE TABLE IF NOT EXISTS "api_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "prefix" text NOT NULL,
  "key_hash" text NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "scopes" text[] NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "api_keys_scopes_check" CHECK ("scopes" <@ ARRAY['ler','escrever','enviar']::text[] AND cardinality("scopes") > 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_hash_uq" ON "api_keys" ("key_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_keys_user_idx" ON "api_keys" ("user_id");--> statement-breakpoint
UPDATE "profiles" SET "permissions" = array_append("permissions", 'api.gerir') WHERE "key" = 'gestao' AND NOT ('api.gerir' = ANY("permissions"));
