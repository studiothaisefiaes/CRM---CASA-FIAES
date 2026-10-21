-- Fase C (item 22): Fidelidade. Programas da Casa e o extrato de pontos de cada cliente (saldo = soma dos `delta`).
-- Os 3 programas nascem aqui com id fixo; os serviços que contam e os que são prêmio são sugestão (a gestão confere na aba Serviços › Fidelidade).
-- Só acrescenta; pode rodar 2 vezes (IF NOT EXISTS e ON CONFLICT DO NOTHING: rodar de novo não troca o que a Casa editou).
CREATE TABLE IF NOT EXISTS "loyalty_programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" text NOT NULL,
	"goal" smallint,
	"counts_service_ids" uuid[],
	"reward_service_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"reward_discount_bp" integer DEFAULT 10000 NOT NULL,
	"max_discount_bp" integer,
	"counts_package_sessions" boolean DEFAULT false NOT NULL,
	"reward_reason_template" text DEFAULT 'Fidelidade: {programa}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loyalty_programs_name_unique" UNIQUE ("name"),
	CONSTRAINT "loyalty_programs_kind_check" CHECK ("kind" IN ('contagem','aniversario')),
	CONSTRAINT "loyalty_programs_goal_check" CHECK ("kind" <> 'contagem' OR "goal" > 0),
	CONSTRAINT "loyalty_programs_bp_check" CHECK ("reward_discount_bp" BETWEEN 1 AND 10000 AND ("max_discount_bp" IS NULL OR "max_discount_bp" BETWEEN 0 AND 10000))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "loyalty_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"comanda_id" uuid,
	"comanda_item_id" uuid,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"external_key" text,
	CONSTRAINT "loyalty_entries_delta_check" CHECK ("delta" <> 0),
	CONSTRAINT "loyalty_entries_reason_check" CHECK ("reason" IN ('servico','resgate','saldo_avec','ajuste'))
);--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loyalty_entries_contact_id_contacts_id_fk') THEN
		ALTER TABLE "loyalty_entries" ADD CONSTRAINT "loyalty_entries_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loyalty_entries_program_id_loyalty_programs_id_fk') THEN
		ALTER TABLE "loyalty_entries" ADD CONSTRAINT "loyalty_entries_program_id_loyalty_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "loyalty_programs"("id");
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loyalty_entries_comanda_id_comandas_id_fk') THEN
		ALTER TABLE "loyalty_entries" ADD CONSTRAINT "loyalty_entries_comanda_id_comandas_id_fk" FOREIGN KEY ("comanda_id") REFERENCES "comandas"("id");
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loyalty_entries_comanda_item_id_comanda_items_id_fk') THEN
		ALTER TABLE "loyalty_entries" ADD CONSTRAINT "loyalty_entries_comanda_item_id_comanda_items_id_fk" FOREIGN KEY ("comanda_item_id") REFERENCES "comanda_items"("id");
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loyalty_entries_created_by_users_id_fk') THEN
		ALTER TABLE "loyalty_entries" ADD CONSTRAINT "loyalty_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");
	END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_entries_contact_program_idx" ON "loyalty_entries" ("contact_id","program_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_entries_comanda_idx" ON "loyalty_entries" ("comanda_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_entries_item_uq" ON "loyalty_entries" ("program_id","comanda_item_id","reason") WHERE "comanda_item_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_entries_external_key_uq" ON "loyalty_entries" ("external_key") WHERE "external_key" IS NOT NULL;--> statement-breakpoint
INSERT INTO "loyalty_programs" ("id","name","description","kind","goal","counts_service_ids","reward_service_ids","reward_discount_bp","max_discount_bp","position") VALUES
	(md5('fidelidade:fiel-da-fiaes')::uuid, 'Fiel da Fiaes', NULL, 'contagem', 12, NULL,
		ARRAY(SELECT "id" FROM "lists" WHERE "kind" = 'service' AND "active" AND "category" ILIKE 'finaliza%' ORDER BY "position", "label"), 10000, 2000, 0),
	(md5('fidelidade:10x-voce')::uuid, '10x Você', 'Acompanhe pelo nosso sistema', 'contagem', 10,
		ARRAY(SELECT "id" FROM "lists" WHERE "kind" = 'service' AND "active" AND "label" ~* '^corte' ORDER BY "position", "label"),
		ARRAY(SELECT "id" FROM "lists" WHERE "kind" = 'service' AND "active" AND "label" ~* '^corte' ORDER BY "position", "label"), 10000, 2000, 1),
	(md5('fidelidade:aniversario')::uuid, 'Aniversário', NULL, 'aniversario', NULL, NULL,
		ARRAY(SELECT "id" FROM "lists" WHERE "kind" = 'service' AND "active" AND "label" ~* 'ritual de tratamento' ORDER BY "position", "label"), 5000, NULL, 2)
ON CONFLICT DO NOTHING;
