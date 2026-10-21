import "dotenv/config";
import { pool } from "../src/server/db";
import { runAvecCleanup } from "../src/server/domain/avec/cleanup";

// Limpa o lixo que a importação antiga do Avec deixou (17/10), com as mesmas regras da importação nova:
//   (completar cadastro) no nome · cancelamentos às 00:00 · CLIENTE PADRÃO nas visitas · datas impossíveis (2029, 2923, 4676)
//   · status que o CRM não conhece · remarcações que ficaram vivas · "Atendimento" do lead duplicado · horários pagos sem baixa.
// Também cobre os scripts de dados 02 e 05 do coordenador (rode só este).
// Uso: DATABASE_URL=... npx tsx scripts/limpar-avec-lixo.ts --dry-run    (faz e desfaz cada lote: mostra os números, não grava nada)
//      DATABASE_URL=... npx tsx scripts/limpar-avec-lixo.ts --aplicar    (grava; lotes em transações curtas; rodar de novo não faz nada)
// A saída só tem números (nenhum nome de cliente).

async function main() {
  const arg = process.argv.slice(2);
  const apply = arg.includes("--aplicar");
  if (apply === arg.includes("--dry-run")) throw new Error("Use --dry-run (só mostra) ou --aplicar (grava).");
  console.log(apply ? "Aplicando (grava)…" : "Dry-run (nada é gravado)…");
  const r = await runAvecCleanup({ apply, now: new Date(), log: (s) => console.log(`  ${s}`) });
  console.log(JSON.stringify(r, null, 2));
}
main().then(() => pool.end()).catch(async (e) => { console.error(e instanceof Error ? e.message : e); await pool.end(); process.exit(1); });
