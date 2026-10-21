-- Fase C (item 19): marcador (etiqueta do horário) e tipo do horário (Indicação, Noiva). Só acrescenta; pode rodar 2 vezes.
CREATE TABLE IF NOT EXISTS "appointment_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid REFERENCES "users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "appointment_labels_name_uq" ON "appointment_labels" USING btree (lower("name"));--> statement-breakpoint
INSERT INTO "appointment_labels" ("name", "position") VALUES
	('Foi Atendida', 0), ('08H', 1), ('VER OBS', 2), ('Atrasada', 3), ('Não Cobrar', 4),
	('revisão', 5), ('Representantes', 6), ('ON LINE', 7), ('CLIENTE DOENTE - VAI REMARCAR', 8)
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "label_id" uuid REFERENCES "appointment_labels"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "visit_type" text;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_visit_type_check') THEN
		ALTER TABLE "appointments" ADD CONSTRAINT "appointments_visit_type_check" CHECK ("visit_type" IS NULL OR "visit_type" IN ('indicacao','noiva'));
	END IF;
END $$;
