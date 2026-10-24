import "dotenv/config";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { inArray } from "drizzle-orm";
import { db, pool } from "../src/server/db";
import { deals } from "../src/server/db/schema";
import { applyStaleConversations, planStaleConversations, STALE_DAYS } from "../src/server/domain/organizar-parados";

// Em conversa parada (a Casa falou por último há mais de 7 dias, sem combinado/horário à frente) → Perdido "Não respondeu mais". Idempotente.
// Ensaio:  npx tsx scripts/organizar-parados.ts --dry-run
// Aplicar: BACKUP_DIR=/home/crm/backups npx tsx scripts/organizar-parados.ts --aplicar   (backup JSON das linhas de deals, aplica, confere)

async function main() {
  const mode = process.argv.includes("--aplicar") ? "aplicar" : process.argv.includes("--dry-run") ? "ensaio" : null;
  if (!mode) throw new Error("Use --dry-run (ensaio) ou --aplicar");
  const ids = await planStaleConversations();
  console.log(`Em conversa parada há mais de ${STALE_DAYS} dias (a Casa falou por último): ${ids.length}`);
  if (mode === "ensaio" || !ids.length) return;
  const dir = process.env.BACKUP_DIR ?? path.resolve("data/backups");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `organizar-parados-${new Date().toISOString().replace(/[:.]/g, "-")}-antes.json`);
  await access(file).then(() => { throw new Error(`Backup já existe: ${file}`); }, () => undefined);
  await writeFile(file, JSON.stringify({ geradoEm: new Date().toISOString(), deals: await db.select().from(deals).where(inArray(deals.id, ids)) }, null, 2));
  console.log(`Backup: ${file}`);
  const r = await applyStaleConversations(ids);
  const after = await planStaleConversations();
  console.log(`Movidas: ${r.moved}. Erros: ${r.errors.length}${r.errors.length ? `\n${r.errors.join("\n")}` : ""}. Conferência: ${after.length} continuam paradas.`);
  if (after.length !== ids.length - r.moved) throw new Error(`Conferência falhou: esperava ${ids.length - r.moved}, ficou ${after.length}`);
}
main().then(() => pool.end()).catch(async (e) => { console.error(e.message); await pool.end(); process.exit(1); });
