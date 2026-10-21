import "dotenv/config";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "../src/server/db";
import { applyTaskAssigneeFix, fixSummary, planTaskAssigneeFix, type AssigneeFix } from "../src/server/domain/task-assignee";

// Tarefas abertas sem responsável → dona do lead ou quem respondeu por último. Idempotente.
// Ensaio:  npx tsx scripts/tarefas-sem-responsavel.ts --dry-run   (imprime a tabela antes/depois, não grava)
// Aplicar: BACKUP_DIR=/home/crm/backups npx tsx scripts/tarefas-sem-responsavel.ts --aplicar   (backup JSON, aplica, confere)

const table = (plan: AssigneeFix[]) => {
  console.table(fixSummary(plan));
  const semDestino = plan.filter((p) => !p.to).length;
  console.log(`Sem responsável antes: ${plan.length} · depois: ${semDestino} · vão receber dona: ${plan.length - semDestino}`);
};

async function main() {
  const mode = process.argv.includes("--aplicar") ? "aplicar" : process.argv.includes("--dry-run") ? "ensaio" : null;
  if (!mode) throw new Error("Use --dry-run (ensaio) ou --aplicar");
  const plan = await planTaskAssigneeFix();
  table(plan);
  if (mode === "ensaio") return;
  const dir = process.env.BACKUP_DIR ?? path.resolve("data/backups");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `tarefas-sem-responsavel-${new Date().toISOString().replace(/[:.]/g, "-")}-antes.json`);
  await access(file).then(() => { throw new Error(`Backup já existe: ${file}`); }, () => undefined);
  await writeFile(file, JSON.stringify({ geradoEm: new Date().toISOString(), tarefas: plan }, null, 2));
  console.log(`Backup: ${file}`);
  const n = await applyTaskAssigneeFix(plan);
  const after = await planTaskAssigneeFix();
  console.log(`Aplicado: ${n} tarefas. Conferência: ${after.length} continuam sem responsável.`);
  if (after.length !== plan.length - n) throw new Error(`Conferência falhou: esperava ${plan.length - n}, ficou ${after.length}`);
}
main().then(() => pool.end()).catch(async (e) => { console.error(e.message); await pool.end(); process.exit(1); });
