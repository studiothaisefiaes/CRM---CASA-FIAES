-- Pesquisa de satisfação (Fase B, Task 9): uma linha por enquete de 1 a 5 enviada (depois do atendimento ou pela regra). Só acrescenta.
-- Gravada quando a enquete sai, com as profissionais e os serviços da visita; o voto (último que vale) preenche score/answered_at.
CREATE TABLE IF NOT EXISTS "satisfaction_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visit_id" uuid REFERENCES "visits"("id") ON DELETE SET NULL,
	"deal_id" uuid NOT NULL REFERENCES "deals"("id") ON DELETE CASCADE,
	"contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
	"poll_message_id" uuid NOT NULL REFERENCES "messages"("id") ON DELETE CASCADE,
	"score" smallint,
	"professional_ids" uuid[] DEFAULT '{}' NOT NULL,
	"service_ids" uuid[] DEFAULT '{}' NOT NULL,
	"asked_at" timestamp with time zone NOT NULL,
	"answered_at" timestamp with time zone,
	CONSTRAINT "satisfaction_answers_score_check" CHECK ("score" IS NULL OR "score" BETWEEN 1 AND 5)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "satisfaction_answers_poll_uq" ON "satisfaction_answers" USING btree ("poll_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "satisfaction_answers_asked_idx" ON "satisfaction_answers" USING btree ("asked_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "satisfaction_answers_contact_idx" ON "satisfaction_answers" USING btree ("contact_id");
