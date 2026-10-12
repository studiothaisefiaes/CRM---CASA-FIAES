import "dotenv/config";
import { DEMO_DATABASE, isDemoDatabaseUrl } from "../src/server/demo";

// Primeiro import dos scripts da demonstração: recusa rodar (antes de qualquer consulta) se o banco não for o crm_demo.
if (!isDemoDatabaseUrl(process.env.DATABASE_URL)) {
  console.error(`Recusado: a demonstração só roda no banco ${DEMO_DATABASE} (DATABASE_URL terminando em /${DEMO_DATABASE}). Use scripts/demo.sh.`);
  process.exit(1);
}
process.env.TZ ??= "America/Bahia";
