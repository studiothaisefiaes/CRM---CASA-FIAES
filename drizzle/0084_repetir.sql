-- Fase C (item 23a): repetir o horário a cada X semanas. Só acrescenta; pode rodar 2 vezes.
-- CHECK só de sanidade (R4): os limites da Casa (padrão 12 semanas e 26 vezes) ficam em settings `repetir` e são conferidos no domínio.
CREATE TABLE IF NOT EXISTS "appointment_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"every_weeks" smallint NOT NULL,
	"times" smallint NOT NULL,
	"request_key" uuid NOT NULL,
	"created_by" uuid REFERENCES "users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_series_every_weeks_check" CHECK ("every_weeks" BETWEEN 1 AND 52),
	CONSTRAINT "appointment_series_times_check" CHECK ("times" BETWEEN 2 AND 104)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "appointment_series_request_uq" ON "appointment_series" USING btree ("request_key");--> statement-breakpoint
-- A série do horário (só do CRM: não marca crm_touched_at). Apagar a série não apaga o horário.
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "series_id" uuid REFERENCES "appointment_series"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointments_series_idx" ON "appointments" USING btree ("series_id") WHERE "series_id" IS NOT NULL;
