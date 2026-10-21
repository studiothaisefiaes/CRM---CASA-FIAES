-- Setores (Fase B, item 15): Recepção, Método Fiaes® e Serviços gerais; a conversa pode ser passada para um setor. Só acrescenta.
CREATE TABLE IF NOT EXISTS "teams" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "teams_name_uq" ON "teams" USING btree (lower("name"));--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_members" (
  "team_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  CONSTRAINT "team_members_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "team_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "deals" ADD CONSTRAINT "deals_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "teams"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deals_team_idx" ON "deals" USING btree ("team_id") WHERE "team_id" IS NOT NULL;--> statement-breakpoint
INSERT INTO "teams" ("name", "position") VALUES ('Recepção', 1), ('Método Fiaes®', 2), ('Serviços gerais', 3) ON CONFLICT DO NOTHING;
