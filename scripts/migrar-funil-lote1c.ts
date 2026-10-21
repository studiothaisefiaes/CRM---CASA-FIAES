import "dotenv/config";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { pool } from "../src/server/db";
import { applyFunnelMigration, backupSnapshot, migrateStagesConfig, openByStage, planFunnelMigration, summarize } from "../src/server/domain/funnel-migration";

// Lote 1C: organiza as conversas abertas no funil novo, pela tabela "Migração" da spec (docs/superpowers/specs/2026-10-15-crm-sistema-completo-design.md).
// Ensaio (não grava nada):  npx tsx scripts/migrar-funil-lote1c.ts --dry-run
// Aplicar (com backup):     npx tsx scripts/migrar-funil-lote1c.ts --aplicar --backup /home/crm/backups/funil-lote1c-AAAA-MM-DD-antes.json
// Antes: npm run db:migrate && npm run db:seed (as etapas novas nascem no seed). Idempotente. Nunca envia mensagem.

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const arg = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

function table(rows: Record<string, string | number>[]) {
  if (!rows.length) { console.log("  (nada)"); return; }
  const cols = Object.keys(rows[0]);
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)));
  const line = (vals: (string | number)[]) => "| " + vals.map((v, i) => String(v).padEnd(w[i])).join(" | ") + " |";
  console.log(line(cols));
  console.log("|" + w.map((x) => "-".repeat(x + 2)).join("|") + "|");
  for (const r of rows) console.log(line(cols.map((c) => r[c])));
}
const stageTable = async () => table((await openByStage()).map((r) => ({ Etapa: r.etapa, Conversas: r.conversas })));

async function main() {
  const dry = has("--dry-run"), apply = has("--aplicar");
  if (dry === apply) throw new Error("Use --dry-run (ensaio) ou --aplicar --backup <arquivo.json>.");
  const file = arg("--backup");
  if (apply && !file) throw new Error("Informe --backup <arquivo.json> (ex.: /home/crm/backups/funil-lote1c-2026-10-16-antes.json).");
  if (file && existsSync(file)) throw new Error(`${file} já existe: escolha outro nome (o backup nunca é sobrescrito).`);
  const now = new Date();
  console.log(`Funil novo (Lote 1C) · ${apply ? "APLICANDO" : "ENSAIO, nada é gravado"} · ${now.toISOString()}\n`);
  console.log("ANTES: conversas abertas por etapa"); await stageTable();
  console.log("\n1. Etapas"); for (const c of await migrateStagesConfig(false)) console.log(`  - ${c}`);
  const plan = await planFunnelMigration(now);
  console.log("\n2. Conversas (compare com a tabela da spec)");
  table(summarize(plan).map((r) => ({ Hoje: r.hoje, Situação: r.situacao, Conversas: r.conversas, "Vai para": r.vaiPara })));
  const review = plan.filter((r) => r.target === "revisar");
  if (review.length) { console.log("\nRevisão manual (Agendado sem horário no Avec; ficam em Agendado):"); for (const r of review) console.log(`  - ${r.name.split(/\s+/)[0]} · lead ${r.dealId}`); }
  const tomorrow = plan.filter((r) => r.target === "followup").length;
  console.log(`\nCombinados "Tentativa 1 de 3" que vão vencer no próximo dia de expediente (viram aviso): até ${tomorrow}`);
  if (dry) return;

  await writeFile(file!, JSON.stringify(await backupSnapshot(plan), null, 1), { mode: 0o600 });
  console.log(`\nBackup: ${file}`);
  console.log(`Etapas: ${(await migrateStagesConfig(true)).length} ajuste(s)`);
  const r = await applyFunnelMigration(plan, now);
  console.log(`Conversas movidas: ${r.applied}`);
  for (const f of r.failed) console.log(`  ✗ ${f.name.split(/\s+/)[0]} (${f.dealId ?? "sem conversa"}): ${f.error}`);
  // Conferência: depois de aplicar, um novo ensaio não pode querer mover mais nada.
  const again = (await planFunnelMigration(now)).filter((x) => x.target !== "fica" && x.target !== "revisar");
  console.log("\nDEPOIS: conversas abertas por etapa"); await stageTable();
  if (r.failed.length || again.length) {
    console.log(`\nCONFERÊNCIA FALHOU: ${r.failed.length} erro(s), ${again.length} conversa(s) ainda fora do lugar. Nada foi desfeito; o backup está em ${file}.`);
    process.exitCode = 1;
  } else console.log("\nConferência OK: nenhuma conversa fora do lugar.");
}
main().then(() => pool.end()).catch(async (e) => { console.error(e instanceof Error ? e.message : e); await pool.end(); process.exit(1); });
