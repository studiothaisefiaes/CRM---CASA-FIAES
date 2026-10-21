-- Tipo do contato (17/10): cliente | equipe | fornecedor | spam ("Marcar como…" na Fila e na conversa). Só acrescenta.
-- Compatível com o que já usa `is_team` e `ignored`: as duas colunas continuam e o gatilho mantém tudo igual nos dois sentidos
--   equipe ⇔ is_team; spam ⇔ ignored ("Não é cliente": escondido, recuperável); fornecedor e cliente: as duas falsas.
-- Quem grava só `is_team`/`ignored` (código antigo) muda o tipo; quem grava `kind` acerta as duas colunas.
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'cliente' NOT NULL;--> statement-breakpoint
-- Dados: "Não é cliente" vira Spam (o mesmo comportamento: fora da Fila, guardado, volta com "Voltar a ser cliente"); Equipe continua Equipe.
UPDATE "contacts" SET "kind" = CASE WHEN "ignored" THEN 'spam' WHEN "is_team" THEN 'equipe' ELSE 'cliente' END WHERE "kind" = 'cliente' AND ("ignored" OR "is_team");--> statement-breakpoint
ALTER TABLE "contacts" DROP CONSTRAINT IF EXISTS "contacts_kind_check";--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_kind_check" CHECK ("kind" IN ('cliente', 'equipe', 'fornecedor', 'spam'));--> statement-breakpoint
CREATE OR REPLACE FUNCTION contacts_kind_sync() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.kind IS DISTINCT FROM OLD.kind THEN
    NULL; -- o tipo mandou: as colunas antigas seguem abaixo
  ELSIF TG_OP = 'INSERT' AND NEW.kind <> 'cliente' THEN
    NULL;
  ELSIF TG_OP = 'INSERT' OR NEW.is_team IS DISTINCT FROM OLD.is_team OR NEW.ignored IS DISTINCT FROM OLD.ignored THEN
    NEW.kind := CASE WHEN NEW.ignored THEN 'spam' WHEN NEW.is_team THEN 'equipe' ELSE 'cliente' END;
  END IF;
  NEW.is_team := NEW.kind = 'equipe';
  NEW.ignored := NEW.kind = 'spam';
  RETURN NEW;
END
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS contacts_kind_sync ON contacts;--> statement-breakpoint
CREATE TRIGGER contacts_kind_sync BEFORE INSERT OR UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION contacts_kind_sync();--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_kind_idx" ON "contacts" USING btree ("kind") WHERE "kind" <> 'cliente';
