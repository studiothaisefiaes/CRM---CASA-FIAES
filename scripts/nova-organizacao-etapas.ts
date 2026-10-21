import "dotenv/config";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { pool } from "../src/server/db";
import { applyNovaOrganizacao, openByStageNow, planNovaOrganizacao, revertNovaOrganizacao, type NovaOrgBackup } from "../src/server/domain/nova-organizacao";

// Nova organização (16/10): etapas Em conversa · Orçamento · Hora de voltar; "Aguardando cliente" e "Fechado" saem do funil.
// Migração de DADOS (nunca envia mensagem), com ensaio, backup JSON e volta pelo backup. Rode DEPOIS do deploy do código novo.
// Ensaio:   npx tsx scripts/nova-organizacao-etapas.ts --dry-run
// Aplicar:  npx tsx scripts/nova-organizacao-etapas.ts --aplicar --backup /home/crm/backups/nova-organizacao-AAAA-MM-DD.json
// Reverter: npx tsx scripts/nova-organizacao-etapas.ts --reverter /home/crm/backups/nova-organizacao-AAAA-MM-DD.json

const args = process.argv.slice(2);
const arg = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

async function main() {
  const dry = args.includes("--dry-run"), apply = args.includes("--aplicar"), revert = arg("--reverter");
  const file = arg("--backup");
  if ([dry, apply, !!revert].filter(Boolean).length !== 1) throw new Error("Use --dry-run, ou --aplicar --backup <arquivo novo>, ou --reverter <backup.json>.");

  if (revert) {
    const backup = JSON.parse(await readFile(revert, "utf8")) as NovaOrgBackup;
    console.log(`Revertendo a nova organização feita em ${backup.feitoEm} (${backup.deals.length} conversas no backup)\n`);
    const r = await revertNovaOrganizacao(backup);
    console.log(`Etapas restauradas: ${r.stages} · conversas de volta: ${r.deals}`);
    if (r.skipped.length) console.log(`Ficaram como estão (a equipe já mexeu depois): ${r.skipped.length}\n  ${r.skipped.join("\n  ")}`);
    console.log("\nDEPOIS:"); console.table(await openByStageNow());
    return;
  }
  if (apply && (!file || existsSync(file))) throw new Error("Informe --backup com um arquivo novo.");

  console.log(`Nova organização das etapas · ${apply ? "APLICANDO" : "ENSAIO"}\n`);
  console.log("ANTES:"); console.table(await openByStageNow());
  const plan = await planNovaOrganizacao();
  console.log("Etapas:"); for (const t of plan.stageChanges) console.log(`  - ${t}`);
  const abertasAguardando = plan.aguardando.filter((r) => !r.conversationArchivedAt);
  console.log(`\nAguardando cliente → Em conversa (as tentativas continuam): ${plan.aguardando.length} (${abertasAguardando.length} não resolvidas)`);
  console.log(`Fechado → Atendida, terminada e Resolvida: ${plan.fechado.length}`);
  if (dry) return;

  // O backup é gravado dentro da transação: se o arquivo não for gravado, nada é aplicado.
  const r = await applyNovaOrganizacao(new Date(), { beforeCommit: (b) => writeFile(file!, JSON.stringify(b, null, 1), { mode: 0o600, flag: "wx" }) });
  console.log(`\nBackup: ${file}`);
  console.log(`Feito: ${r.stageChanges.length} ajuste(s) de etapa · ${r.aguardando} de Aguardando · ${r.fechado} de Fechado`);
  console.log("\nDEPOIS:"); console.table(await openByStageNow());
}
main().then(() => pool.end()).catch(async (e) => { console.error(e instanceof Error ? e.message : e); await pool.end(); process.exit(1); });
