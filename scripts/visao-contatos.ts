import "dotenv/config";
import { TransactionRollbackError } from "drizzle-orm";
import { db, pool } from "../src/server/db";
import { refreshContactStatsTx, statsSummary } from "../src/server/domain/contact-stats";
import { contactFilterCounts } from "../src/server/queries/contacts";

/**
 * Visão por contato (Lote 2). `--dry-run` (padrão): calcula numa transação, imprime o resumo e DESFAZ. `--aplicar`: grava.
 * Só escreve na tabela derivada `contact_stats` (pode ser refeita a qualquer hora a partir do Avec e do CRM: não precisa de backup).
 * Nunca envia mensagem. Conferir o resumo com a auditoria de 15/10 antes de aplicar.
 */
async function main() {
  const apply = process.argv.includes("--aplicar");
  try {
    await db.transaction(async (tx) => {
      const r = await refreshContactStatsTx(tx, new Date());
      const s = await statsSummary(tx);
      console.log(`${apply ? "GRAVADO" : "ENSAIO (nada foi gravado)"}: ${r.contatos} contatos, ${r.comVisita} com pelo menos uma visita (${r.ms} ms)`);
      console.log("Visitas por cliente (auditoria 15/10: 1 = 2.363 · 2 a 4 = 1.110 · 5 a 11 = 513 · 12+ = 167):");
      console.log(`  1 visita: ${s.uma} · 2 a 4: ${s.duasAQuatro} · 5 a 11: ${s.cincoAOnze} · 12 ou mais: ${s.dozeOuMais}`);
      console.log(`Com ritmo (3+ visitas): ${s.comRitmo} (auditoria: 1.163) · ritmo mediano: ${s.ritmoMediano ?? "—"} dias (auditoria: 62)`);
      console.log(`Com profissional preferida calculada: ${s.comPreferida} (auditoria: 752)`);
      const f = await contactFilterCounts({ now: new Date() }, tx);
      console.log(`Filtros (auditoria 15/10: sumidas ~199 · na hora ~118 · aniversário semana 60 · mês 292 · nunca voltou 2.363):`);
      console.log(`  sumidas ${f.sumidas} · na hora ${f.na_hora} · aniversário semana ${f.aniversario_semana} · mês ${f.aniversario_mes} · nunca voltou ${f.nunca_voltou}`);
      console.log(`  com pacote ${f.com_pacote} · com horário ${f.com_horario} · sem dono ${f.sem_dono} · VIP ${f.vip} · faltosas ${f.faltosas}`);
      if (!apply) tx.rollback();
    });
  } catch (e) {
    if (!(e instanceof TransactionRollbackError)) throw e;
  }
}
main().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
