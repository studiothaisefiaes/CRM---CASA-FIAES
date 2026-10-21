ALTER TABLE "outbox" ADD COLUMN "status_at" timestamp with time zone;--> statement-breakpoint
-- Mensagens programadas: a hora em que cada item mudou de status (cancelada, falhou, saiu), sem mexer em quem atualiza. Só acrescenta.
CREATE OR REPLACE FUNCTION outbox_status_at() RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN NEW.status_at := now(); END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS outbox_status_at ON "outbox";--> statement-breakpoint
CREATE TRIGGER outbox_status_at BEFORE UPDATE OF status ON "outbox" FOR EACH ROW EXECUTE FUNCTION outbox_status_at();
