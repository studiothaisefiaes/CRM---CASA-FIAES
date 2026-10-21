-- Fase D: dados fiscais (item 26). Só acrescenta. Nenhum segredo aqui: certificado, senha e CSC ficam no .env do servidor.
ALTER TABLE "professionals" ADD COLUMN IF NOT EXISTS "bond" text;--> statement-breakpoint
ALTER TABLE "professionals" ADD COLUMN IF NOT EXISTS "cnpj" text;--> statement-breakpoint
ALTER TABLE "professionals" ADD COLUMN IF NOT EXISTS "legal_name" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "professionals" ADD CONSTRAINT "professionals_bond_ck" CHECK ("bond" is null or "bond" in ('parceira', 'clt', 'outro'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "professionals" ADD CONSTRAINT "professionals_cnpj_ck" CHECK ("cnpj" is null or "cnpj" ~ '^[0-9]{14}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
ALTER TABLE "lists" ADD COLUMN IF NOT EXISTS "fiscal_ctribnac" text;--> statement-breakpoint
ALTER TABLE "lists" ADD COLUMN IF NOT EXISTS "fiscal_nbs" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "lists" ADD CONSTRAINT "lists_fiscal_ctribnac_ck" CHECK ("fiscal_ctribnac" is null or "fiscal_ctribnac" ~ '^[0-9]{6}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
ALTER TABLE "comanda_items" ADD COLUMN IF NOT EXISTS "net_cents" integer;--> statement-breakpoint
ALTER TABLE "comanda_items" ADD COLUMN IF NOT EXISTS "partner_cnpj" text;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fiscal_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "comanda_id" uuid NOT NULL REFERENCES "comandas"("id"),
  "kind" text NOT NULL,
  "environment" text NOT NULL,
  "series" integer NOT NULL,
  "number" bigint NOT NULL,
  "local_id" text NOT NULL,
  "access_key" text,
  "status" text NOT NULL DEFAULT 'pendente',
  "amount_cents" integer NOT NULL,
  "request_xml" text,
  "response_body" text,
  "reject_reason" text,
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "next_try_at" timestamp with time zone,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "authorized_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "cancelled_by" uuid REFERENCES "users"("id"),
  "cancel_reason" text,
  CONSTRAINT "fiscal_documents_kind_ck" CHECK ("kind" in ('nfse', 'nfce')),
  CONSTRAINT "fiscal_documents_env_ck" CHECK ("environment" in ('teste', 'producao')),
  CONSTRAINT "fiscal_documents_status_ck" CHECK ("status" in ('pendente', 'autorizada', 'rejeitada', 'erro_envio', 'cancelada'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_documents_live_uq" ON "fiscal_documents" USING btree ("comanda_id", "kind") WHERE "status" in ('pendente', 'autorizada');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_documents_number_uq" ON "fiscal_documents" USING btree ("kind", "environment", "series", "number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fiscal_documents_comanda_idx" ON "fiscal_documents" USING btree ("comanda_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fiscal_sequences" (
  "kind" text NOT NULL,
  "environment" text NOT NULL,
  "series" integer NOT NULL,
  "next_number" bigint NOT NULL DEFAULT 1,
  PRIMARY KEY ("kind", "environment", "series")
);--> statement-breakpoint
UPDATE "profiles" SET "permissions" = array_append("permissions", 'nota.configurar') WHERE "key" = 'gestao' AND NOT 'nota.configurar' = ANY("permissions");
