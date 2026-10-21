import "dotenv/config";
import { pool } from "../src/server/db";
import { undoAvecOverclose } from "../src/server/domain/avec/undo-overclose";

// Corrige o que a limpeza do Avec de 18/10 (limpar-avec-lixo --aplicar, regra antiga) fez a mais (QA r58, I-14):
//   · baixas: a venda fechou como compareceu todos os horários da cliente no dia. Volta ao status de antes só os que a regra nova não
//     fecharia (a venda não bate com a profissional nem com o serviço; pagamento sem item) e marca para "Conferir com o Avec";
//   · "Atendimento" do lead cancelado por horário do Avec do mesmo dia a mais de 2 h: volta e vai para "Conferir com o Avec";
//   · os "espera" às 00:00 que vieram do 0248 "Agendamentos por status › Agendado" (não é lista de espera): saem do banco quando nada
//     aponta para eles (conversa, comanda, nota, aviso da profissional, link); cada um fica no audit_log (avec_espera_apagada) com a linha.
// Só mexe no que ficou como a limpeza deixou. Cada desfeito grava audit_log (avec_baixa_desfeita / avec_atendimento_desfeito) com o id
// do registro original (data.auditId), então dá para saber exatamente o que mudou. Rodar de novo não faz nada.
// Uso: DATABASE_URL=... npx tsx scripts/corrigir-avec-baixas.ts --dry-run    (faz e desfaz: mostra os números, não grava nada)
//      DATABASE_URL=... npx tsx scripts/corrigir-avec-baixas.ts --aplicar    (grava, numa transação só)
// A saída só tem números (nenhum nome de cliente).

async function main() {
  const arg = process.argv.slice(2);
  const apply = arg.includes("--aplicar");
  if (apply === arg.includes("--dry-run")) throw new Error("Use --dry-run (só mostra) ou --aplicar (grava).");
  console.log(apply ? "Aplicando (grava)…" : "Dry-run (nada é gravado)…");
  const r = await undoAvecOverclose({ apply, now: new Date() });
  console.log(`  baixas da limpeza: ${r.baixas.total} · ficam ${r.baixas.ficam} · ${apply ? "desfeitas" : "seriam desfeitas"} ${r.baixas.desfeitas} (${r.baixas.semItens} só com pagamento) · mexidas depois ${r.baixas.mexidos} · já desfeitas ${r.baixas.jaDesfeitas}`);
  console.log(`  Atendimentos juntados: ${r.atendimentos.total} · ficam ${r.atendimentos.ficam} · ${apply ? "desfeitos" : "seriam desfeitos"} ${r.atendimentos.desfeitos} · mexidos depois ${r.atendimentos.mexidos} · já desfeitos ${r.atendimentos.jaDesfeitos}`);
  console.log(`  "espera" que vieram do 0248 (Agendamentos por status › Agendado): ${r.espera.total} · ${apply ? "apagadas" : "seriam apagadas"} ${r.espera.apagadas} · ficam (algo aponta para elas) ${r.espera.ficam}`);
  console.log(`  baixas desfeitas por dia da baixa: ${JSON.stringify(r.baixas.porDia)} · conversas movidas pelo Avec depois (conferir à mão): ${r.baixas.conversasMovidas}`);
  console.log(JSON.stringify(r, null, 2));
}
main().then(() => pool.end()).catch(async (e) => { console.error(e instanceof Error ? e.message : e); await pool.end(); process.exit(1); });
