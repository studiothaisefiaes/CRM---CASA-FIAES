CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text,
	"name" text NOT NULL,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "profile_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_name_uq" ON "profiles" USING btree (lower("name"));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Perfis de sistema (o seed mantém em dia; aqui só para o backfill abaixo já ter destino). Iguais a SYSTEM_PROFILES em src/lib/permissions.ts.
INSERT INTO "profiles" ("key", "name", "permissions", "is_system") VALUES
  ('gestao', 'Gestão', ARRAY['atendimento.ver','atendimento.todas','atendimento.transferir','atendimento.fechar','alertas.escalada','quadro.ver','jornada.ver','contatos.ver','valores.ver','relatorios.ver','relatorios.equipe','relatorios.exportar','config.editar','equipe.gerir']::text[], true),
  ('atendente', 'Atendente', ARRAY['atendimento.ver','atendimento.transferir','atendimento.fechar','distribuicao.receber','quadro.ver','contatos.ver','relatorios.ver','relatorios.exportar']::text[], true),
  ('recepcao', 'Recepção', ARRAY['atendimento.ver','distribuicao.receber']::text[], true)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
-- Cada pessoa recebe o perfil equivalente ao papel de hoje (só preenche quem ainda não tem perfil).
UPDATE "users" SET "profile_id" = (SELECT "id" FROM "profiles" WHERE "key" = CASE "users"."role" WHEN 'gestor' THEN 'gestao' ELSE 'atendente' END)
WHERE "profile_id" IS NULL;
