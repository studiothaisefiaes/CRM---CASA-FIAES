-- Linhas do Avec recusadas na importação (17/10): data fora do limite (2029, 2923, 4676). Só acrescenta.
CREATE TABLE IF NOT EXISTS "avec_rejected_rows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "external_key" text NOT NULL,
  "reason" text NOT NULL,
  "report_id" uuid REFERENCES "avec_reports"("id") ON DELETE SET NULL,
  "day" text NOT NULL,
  "hm" text,
  "client_name" text,
  "contact_id" uuid REFERENCES "contacts"("id") ON DELETE SET NULL,
  "professional_name" text,
  "service_label" text,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "avec_rejected_rows_key_uq" ON "avec_rejected_rows" USING btree ("external_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "avec_rejected_rows_seen_idx" ON "avec_rejected_rows" USING btree ("last_seen_at");
