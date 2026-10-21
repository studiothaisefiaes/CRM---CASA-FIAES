import "dotenv/config";
import { pool } from "../src/server/db";
import { marcarSemDesfecho } from "../src/server/domain/agenda/sem-desfecho";

// QA r66, I-6: horários de dias anteriores que ficaram parados. "Chegou" que ninguém finalizou (7 de 17/10) e "agendado/confirmado" já
// passados, SEM venda no dia e SEM conversa recente (14 dias), passam a "sem desfecho" (status `conferir`), com o status de antes guardado
// em avec_status e no audit_log (horario_sem_desfecho). Os que têm venda no dia já foram tratados e ficam. Nunca marca Faltou nem Compareceu.
// Rodar de novo não acha nada (o que já está em conferir não entra).
// Uso: DATABASE_URL=... npx tsx scripts/corrigir-chegou-parado.ts --dry-run    (faz e desfaz: só os números)
//      DATABASE_URL=... npx tsx scripts/corrigir-chegou-parado.ts --aplicar    (grava, numa transação só)
// A saída só tem números (nenhum nome de cliente).

async function main() {
  const arg = process.argv.slice(2);
  const apply = arg.includes("--aplicar");
  if (apply === arg.includes("--dry-run")) throw new Error("Use --dry-run (só mostra) ou --aplicar (grava).");
  console.log(apply ? "Aplicando (grava)…" : "Dry-run (nada é gravado)…");
  const r = await marcarSemDesfecho({ apply, now: new Date() });
  console.log(`  "Chegou" parado de dia anterior: ${apply ? "marcados" : "seriam marcados"} ${r.chegou}`);
  console.log(`  agendado/confirmado passado sem venda e sem conversa recente: ${apply ? "marcados" : "seriam marcados"} ${r.agendados}`);
  console.log(`  ficam: com venda no dia ${r.comVenda} · com conversa recente ${r.comConversa}`);
}
main().then(() => pool.end()).catch(async (e) => { console.error(e instanceof Error ? e.message : e); await pool.end(); process.exit(1); });
