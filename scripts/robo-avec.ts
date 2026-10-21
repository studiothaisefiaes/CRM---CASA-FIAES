import "dotenv/config";
import { pool } from "../src/server/db";
import { PlaywrightAvecSource } from "../src/server/domain/avec/robo/client";
import { bahiaDay, bahiaHour } from "../src/server/domain/avec/robo/plan";
import { runRobo } from "../src/server/domain/avec/robo/run";
import { getRoboConfig, getRoboLast } from "../src/server/domain/avec/robo/settings";

// Robô do Avec: baixa os relatórios que o CRM sabe importar e entrega ao mesmo importador do upload (Relatórios › Avec).
// Uso: npx tsx scripts/robo-avec.ts [--dry-run] [--agora] [--semanal] [--so=0051,0186] [--agenda]
//   --agenda   (cron de hora em hora, 20/10) só os relatórios do dia a dia (reservas, cancelamentos, em aberto, comanda e pagamentos), das 8h às 19h,
//              se o robô estiver ligado; não conta como a rodada do dia (a completa continua na hora escolhida).
//   (sem flags, como no cron) só roda se estiver ligado, na hora escolhida em Configurações (Salvador) e ainda não rodou hoje.
//   --dry-run  baixa e conta, sem gravar nada (nem no banco).   --agora  ignora ligado/hora/já rodou hoje.
// Credenciais só no ambiente: AVEC_LOGIN e AVEC_SENHA (no servidor, no .env). Os logs têm só números.
/** O dia a dia da agenda e do caixa: reservas, cancelamentos, reservas em aberto, itens de comanda e pagamentos. */
const AGENDA_REPORTS = ["0051", "0052", "0248", "0186", "0388"];

async function main() {
  const args = process.argv.slice(2);
  const flag = (n: string) => args.includes(n);
  const agenda = flag("--agenda");
  const only = agenda ? AGENDA_REPORTS : args.find((a) => a.startsWith("--so="))?.slice(5).split(",").filter(Boolean);
  const dryRun = flag("--dry-run");
  const now = new Date();

  if (agenda && !dryRun) {
    const cfg = await getRoboConfig();
    if (!cfg.ativo) { console.log("Robô do Avec desligado em Configurações."); return; }
    const h = bahiaHour(now);
    if (h < 8 || h > 19) { console.log("Fora do horário da agenda (8h às 19h de Salvador)."); return; }
  } else if (!dryRun && !flag("--agora")) {
    const cfg = await getRoboConfig();
    if (!cfg.ativo) { console.log("Robô do Avec desligado em Configurações."); return; }
    if (bahiaHour(now) !== cfg.hora) { console.log(`Fora da hora (${cfg.hora}h de Salvador).`); return; }
    const last = await getRoboLast();
    if (last && bahiaDay(new Date(last.em)) === bahiaDay(now)) { console.log("Já rodou hoje."); return; }
  }

  const email = process.env.AVEC_LOGIN, senha = process.env.AVEC_SENHA;
  if (!email || !senha) throw new Error("Faltam AVEC_LOGIN e AVEC_SENHA no ambiente.");
  const source = new PlaywrightAvecSource({ email, senha, slug: process.env.AVEC_SLUG });
  try {
    const r = await runRobo(source, { now, dryRun, forceWeekly: flag("--semanal"), only, partial: agenda, log: console.log, pauseMs: 1500 });
    console.log(`${dryRun ? "[dry-run] " : ""}${r.relatorios.length} relatórios, ${r.relatorios.reduce((a, x) => a + x.linhas, 0)} linhas baixadas, ${r.linhasNovas} registros novos/atualizados, ${r.erros.length} erro(s).`);
    if (!r.ok) process.exitCode = 1;
  } finally { await source.close(); }
}
main().catch(async (e) => {
  console.error(e.message);
  // Falha antes de rodar (login, navegador): também avisa a gestão.
  try { if (!process.argv.includes("--dry-run")) { const { alertRoboFailure } = await import("../src/server/domain/avec/robo/settings"); await alertRoboFailure(bahiaDay(new Date()), `A atualização automática do Avec não rodou: ${e.message}`); } } catch { /* sem banco */ }
  process.exitCode = 1;
}).finally(() => pool.end());
