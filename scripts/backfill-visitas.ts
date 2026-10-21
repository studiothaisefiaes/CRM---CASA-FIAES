// scripts/backfill-visitas.ts
import "dotenv/config";
import { db, pool } from "../src/server/db";
import { assignDayVisitsTx } from "../src/server/domain/agenda/visits";

// Visita por cliente e dia (17/10): 430 de 444 visitas do Avec dos últimos 30 dias estavam sem visita (ela só nascia no job do lembrete),
// e a comanda do dia e o Chegou da visita toda dependem dela. Junta os horários sem visita da mesma cliente no mesmo dia na visita que já
// existe, ou numa nova. Lista de espera (00:00) e cancelamento do Avec sem hora ficam de fora. Idempotente: rodar de novo não muda nada.
// No servidor: cd /opt/crm && sudo -u crm npx tsx scripts/backfill-visitas.ts <modo>
//   --dry-run   ensaio: conta o que mudaria e desfaz (nada é gravado)
//   --aplicar   grava numa transação; rodar de novo deve mostrar 0
class DryRun extends Error {}
const args = process.argv.slice(2);

async function main() {
  const apply = args.includes("--aplicar");
  if (!apply && !args.includes("--dry-run")) { console.log("Use --dry-run (ensaio) ou --aplicar."); process.exitCode = 1; return; }
  let r = { appointments: 0, visits: 0 };
  try {
    await db.transaction(async (tx) => {
      r = await assignDayVisitsTx(tx);
      if (!apply) throw new DryRun();
    });
  } catch (e) { if (!(e instanceof DryRun)) throw e; }
  console.log(`${apply ? "Aplicado" : "Ensaio (nada gravado)"}: ${r.appointments} horários ligados a uma visita; ${r.visits} visitas novas.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
