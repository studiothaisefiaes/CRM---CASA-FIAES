import "dotenv/config";
import path from "node:path";
import { pool } from "../src/server/db";
import { applyNotesMerge, planNotesMerge, restoreNotesMerge } from "../src/server/domain/notes-merge";

/**
 * Lote 2: junta no contato as anotações presas nos leads (auditoria de 15/10: 109 leads).
 *   --dry-run (padrão)            mostra quem muda e não grava
 *   --aplicar [--backup arquivo]  grava (backup JSON antes; padrão em $BACKUP_DIR ou na pasta atual) e confere no fim
 *   --desfazer arquivo            volta cada contato ao texto do backup
 * Nunca envia mensagem. `deals.observations` não é apagado.
 */
async function main() {
  const a = process.argv.slice(2);
  const undo = a.indexOf("--desfazer");
  if (undo >= 0) {
    const r = await restoreNotesMerge(a[undo + 1]);
    console.log(`Desfeito: ${r.restored} contatos voltaram ao texto de antes.`);
    return;
  }
  const plan = await planNotesMerge();
  console.table(plan.map((r) => ({ contato: r.name ?? r.contactId, anotacoes: r.added, antes: (r.before ?? "").length, depois: (r.after ?? "").length })));
  console.log(`${plan.length} contatos, ${plan.reduce((n, r) => n + r.added, 0)} anotações para juntar.`);
  if (!a.includes("--aplicar")) { console.log("ENSAIO: nada foi gravado. Para gravar: --aplicar"); return; }
  const b = a.indexOf("--backup");
  const file = b >= 0 ? a[b + 1] : path.join(process.env.BACKUP_DIR ?? ".", `anotacoes-${new Date().toISOString().slice(0, 10)}-antes.json`);
  const r = await applyNotesMerge(file);
  console.log(`Gravado: ${r.updated} contatos. Backup: ${r.backup}`);
  const left = await planNotesMerge();
  console.log(left.length ? `Conferência: ${left.length} contatos ainda com anotação de fora (rode o ensaio e veja).` : "Conferência: nada pendente.");
}
main().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
