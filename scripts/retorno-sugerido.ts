import "dotenv/config";
import { pool } from "../src/server/db";
import { getSuggestedReturnSetting, planSuggestedReturns, sweepSuggestedReturns } from "../src/server/domain/suggested-return";

/**
 * Lote 2: Retorno sugerido automático.
 *   --dry-run (padrão)  quem entraria HOJE (sem gravar), com o teto do dia
 *   --aplicar           roda a varredura uma vez agora (só se a gestão já ligou em Configurações › Automações)
 * Nunca envia mensagem: cria cartão e combinado.
 */
async function main() {
  const cfg = await getSuggestedReturnSetting();
  const plan = await planSuggestedReturns(new Date(), cfg.maxPorDia);
  console.log(`Retorno sugerido: ${cfg.ativo ? "LIGADO" : "desligado"} · teto ${cfg.maxPorDia} por dia`);
  console.table(plan.map((p) => ({ cliente: p.name ?? p.contactId, ultimaVisita: p.lastVisitOn, aCadaDias: p.everyDays, prevista: p.dueOn })));
  console.log(`${plan.length} entrariam hoje.`);
  if (!process.argv.includes("--aplicar")) { console.log("ENSAIO: nada foi gravado."); return; }
  if (!cfg.ativo) { console.log("Desligado: ligue em Configurações › Automações antes de aplicar."); process.exitCode = 1; return; }
  const r = await sweepSuggestedReturns(new Date());
  console.log(`Feito: ${r.criados} cartões novos · ${r.pelaAgenda} foram pela agenda · ${r.aguardando} para Aguardando cliente · ${r.expirados} Retorno não feito${r.erros.length ? ` · erros: ${r.erros.join("; ")}` : ""}`);
}
main().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
