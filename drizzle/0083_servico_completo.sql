-- Fase C (item 24): serviço completo. Só acrescenta; pode rodar 2 vezes.
-- Custo do serviço (centavos). A Fase A (0063_regras_comissao) cria a mesma coluna e o mesmo CHECK `lists_cost_ck`: aqui só se não existir.
ALTER TABLE "lists" ADD COLUMN IF NOT EXISTS "cost_cents" integer;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lists_cost_ck') THEN
		ALTER TABLE "lists" ADD CONSTRAINT "lists_cost_ck" CHECK ("cost_cents" IS NULL OR "cost_cents" >= 0);
	END IF;
END $$;--> statement-breakpoint
-- Preço fixo (null = fixo), "a partir de" ou "sob consulta".
ALTER TABLE "lists" ADD COLUMN IF NOT EXISTS "price_kind" text;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lists_price_kind_check') THEN
		ALTER TABLE "lists" ADD CONSTRAINT "lists_price_kind_check" CHECK ("price_kind" IS NULL OR "price_kind" IN ('fixo','a_partir_de','sob_consulta'));
	END IF;
END $$;--> statement-breakpoint
-- "Pode ser feito junto com outro": null = não informado (o conflito da mesma cliente com outra profissional continua virando encaixe).
ALTER TABLE "lists" ADD COLUMN IF NOT EXISTS "parallel_ok" boolean;--> statement-breakpoint
-- Preço e tempo próprios da profissional naquele serviço (vazio = os do serviço).
ALTER TABLE "professional_services" ADD COLUMN IF NOT EXISTS "price_cents" integer;--> statement-breakpoint
ALTER TABLE "professional_services" ADD COLUMN IF NOT EXISTS "duration_min" smallint;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'professional_services_price_ck') THEN
		ALTER TABLE "professional_services" ADD CONSTRAINT "professional_services_price_ck" CHECK ("price_cents" IS NULL OR "price_cents" >= 0);
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'professional_services_duration_ck') THEN
		ALTER TABLE "professional_services" ADD CONSTRAINT "professional_services_duration_ck" CHECK ("duration_min" IS NULL OR "duration_min" BETWEEN 5 AND 720);
	END IF;
END $$;
