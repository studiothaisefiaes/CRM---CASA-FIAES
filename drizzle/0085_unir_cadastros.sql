-- Fase C (item 25a): Unir cadastros. Só acrescenta; pode rodar 2 vezes.
-- Cada junção guarda quem ficou (kept_id), quem saiu (id, telefone, @lid e nome) e o que não coube (snapshot). Mensagem nova e importação do
-- Avec com o telefone, o @lid ou o nome da que saiu caem na que ficou. Unir A (sai) em B: as junções que apontavam para A passam a B.
CREATE TABLE IF NOT EXISTS "contact_merges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kept_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
	"dropped_id" uuid NOT NULL,
	"dropped_phone" text NOT NULL,
	"dropped_wa_lid" text,
	"dropped_name" text,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"merged_by" uuid REFERENCES "users"("id"),
	"merged_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_merges_dropped_phone_idx" ON "contact_merges" USING btree ("dropped_phone");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_merges_dropped_wa_lid_idx" ON "contact_merges" USING btree ("dropped_wa_lid") WHERE "dropped_wa_lid" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_merges_kept_idx" ON "contact_merges" USING btree ("kept_id");
