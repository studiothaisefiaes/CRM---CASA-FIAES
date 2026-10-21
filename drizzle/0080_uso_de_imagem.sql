-- Fase C (item 20): uso de imagem vira campo da cliente (sim | nao | não informado). Só acrescenta; pode rodar 2 vezes. A etiqueta "Uso de imagem" fica como está.
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "image_use" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "image_use_on" date;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_image_use_check') THEN
		ALTER TABLE "contacts" ADD CONSTRAINT "contacts_image_use_check" CHECK ("image_use" IS NULL OR "image_use" IN ('sim','nao'));
	END IF;
END $$;--> statement-breakpoint
UPDATE "contacts" SET "image_use" = 'sim'
WHERE "image_use" IS NULL AND "id" IN (
	SELECT ct."contact_id" FROM "contact_tags" ct JOIN "tags" t ON t."id" = ct."tag_id" WHERE lower(t."name") = 'uso de imagem'
);
