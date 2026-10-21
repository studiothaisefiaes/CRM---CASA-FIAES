-- Fase D: Contas a pagar (item 27). Categorias, contas bancárias e despesas. Só acrescenta.
CREATE TABLE IF NOT EXISTS "finance_categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "dre_group" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "finance_categories_name_uq" ON "finance_categories" USING btree (lower("name"));--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "bank" text,
  "opening_cents" integer DEFAULT 0 NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bank_accounts_name_uq" ON "bank_accounts" USING btree (lower("name"));--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expenses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" text NOT NULL,
  "category_id" uuid NOT NULL REFERENCES "finance_categories"("id"),
  "supplier" text,
  "amount_cents" integer NOT NULL,
  "due_on" date NOT NULL,
  "competence" date NOT NULL,
  "paid_on" date,
  "paid_cents" integer,
  "bank_account_id" uuid REFERENCES "bank_accounts"("id"),
  "paid_method" text,
  "series_id" uuid,
  "installment" smallint DEFAULT 1 NOT NULL,
  "installments" smallint DEFAULT 1 NOT NULL,
  "notes" text,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "cancelled_at" timestamp with time zone,
  "cancelled_by" uuid REFERENCES "users"("id"),
  "cancel_reason" text,
  CONSTRAINT "expenses_amount_pos" CHECK ("amount_cents" > 0)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expenses_due_idx" ON "expenses" USING btree ("due_on") WHERE "cancelled_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expenses_paid_idx" ON "expenses" USING btree ("paid_on");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expenses_series_idx" ON "expenses" USING btree ("series_id");--> statement-breakpoint
INSERT INTO "finance_categories" ("name", "dre_group", "position") VALUES
  ('Aluguel', 'ocupacao', 1), ('Energia', 'ocupacao', 2), ('Água', 'ocupacao', 3), ('Internet e telefone', 'ocupacao', 4),
  ('Produtos de uso no salão', 'operacao', 5), ('Contador', 'operacao', 6), ('Manutenção', 'operacao', 7),
  ('Salários e encargos', 'pessoal', 8), ('Pró-labore', 'pessoal', 9), ('Impostos (DAS)', 'impostos', 10),
  ('Tarifas bancárias', 'financeiras', 11), ('Marketing', 'marketing', 12), ('Outras despesas', 'outras', 13)
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "profiles" SET "permissions" = array_append("permissions", 'financeiro.lancar') WHERE "key" = 'gestao' AND NOT 'financeiro.lancar' = ANY("permissions");--> statement-breakpoint
UPDATE "profiles" SET "permissions" = array_append("permissions", 'financeiro.pagar') WHERE "key" = 'gestao' AND NOT 'financeiro.pagar' = ANY("permissions");--> statement-breakpoint
UPDATE "profiles" SET "permissions" = array_append("permissions", 'financeiro.cancelar') WHERE "key" = 'gestao' AND NOT 'financeiro.cancelar' = ANY("permissions");--> statement-breakpoint
UPDATE "profiles" SET "permissions" = array_append("permissions", 'financeiro.cadastros') WHERE "key" = 'gestao' AND NOT 'financeiro.cadastros' = ANY("permissions");
