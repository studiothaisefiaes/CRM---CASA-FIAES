-- Auxiliares no horário (20/10): em cada serviço marcado, além da profissional principal, quantas auxiliares a Casa quiser. A auxiliar
-- ocupa a agenda dela no mesmo período (o motor confere conflito) e vira assistente do item quando a comanda abre. Só acrescenta; pode rodar 2 vezes.
-- Uma tabela à parte (e não um horário a mais, como no Avec): a auxiliar não vira "quem atende", não entra no funil, no lembrete nem na comanda como serviço.
CREATE TABLE IF NOT EXISTS "appointment_assistants" (
	"appointment_id" uuid NOT NULL REFERENCES "appointments"("id") ON DELETE CASCADE,
	"professional_id" uuid NOT NULL REFERENCES "professionals"("id"),
	"position" smallint NOT NULL,
	"created_by" uuid REFERENCES "users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_assistants_pk" PRIMARY KEY ("appointment_id", "professional_id"),
	CONSTRAINT "appointment_assistants_position_ck" CHECK ("position" BETWEEN 1 AND 20)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "appointment_assistants_position_uq" ON "appointment_assistants" USING btree ("appointment_id", "position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointment_assistants_pro_idx" ON "appointment_assistants" USING btree ("professional_id");
