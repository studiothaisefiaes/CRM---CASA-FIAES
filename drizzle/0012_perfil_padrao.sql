-- Quem for criado só com o papel antigo (seed:admin, scripts, código antigo numa volta de versão) ganha o perfil equivalente.
-- Só aditivo: uma função e um gatilho de INSERT; não altera linhas existentes (a 0011 já preencheu).
CREATE OR REPLACE FUNCTION users_default_profile() RETURNS trigger AS $$
BEGIN
  IF NEW.profile_id IS NULL THEN
    SELECT id INTO NEW.profile_id FROM profiles WHERE key = CASE NEW.role WHEN 'gestor' THEN 'gestao' ELSE 'atendente' END;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS users_default_profile ON users;--> statement-breakpoint
CREATE TRIGGER users_default_profile BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION users_default_profile();
