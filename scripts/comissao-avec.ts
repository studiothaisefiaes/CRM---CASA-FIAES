// scripts/comissao-avec.ts
import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pool } from "../src/server/db";
import { applyCommissionBackfill, commissionByProfessional, planCommissionBackfill, restoreCommissionBackfill, type CommissionBackup, type CommissionPlan } from "../src/server/domain/avec/commission-backfill";

// Lote 3: comissão histórica dos itens de comanda, lida dos relatórios do Avec já guardados ("Itens de comanda", "Comissão por item").
// No servidor: cd /opt/crm && sudo -u crm npx tsx scripts/comissao-avec.ts <modo>
//   --dry-run                    ensaio: o que entra, o que fica de fora e a conferência por profissional; não grava nada
//   --aplicar [--backup arq]     grava o backup JSON, aplica numa transação e confere (um segundo ensaio tem de vir vazio)
//   --desfazer arq.json          volta os itens ao que estava no backup
const args = process.argv.slice(2);
const flag = (k: string) => args.includes(k);
const value = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function report(plan: CommissionPlan) {
  console.log(`Relatórios usados: ${plan.relatorios.map((r) => `${r.title} (${r.linhas} linhas)`).join(", ") || "nenhum"}`);
  console.log(`Itens que ganham comissão: ${plan.updates.length}`);
  console.log(`Já tinham comissão (não mudam): ${plan.jaTinham}`);
  console.log(`Linhas sem o item no CRM: ${plan.semPar} · ambíguas (ficam de fora): ${plan.ambiguas}`);
  console.log(`\nConferência de ${plan.conferencia.mes} (o que ENTRA agora, por profissional; compare 2 delas com o "Comissão por profissional" do Avec do mesmo mês):`);
  for (const l of plan.conferencia.linhas) console.log(`  ${l.profissional.padEnd(28)} ${String(l.itens).padStart(5)} itens  ${brl(l.comissaoCents)}`);
}

async function main() {
  if (flag("--desfazer")) {
    const file = value("--desfazer");
    if (!file) throw new Error("Informe o arquivo de backup: --desfazer <arquivo.json>");
    const b = JSON.parse(await readFile(file, "utf8")) as CommissionBackup;
    console.log(`Desfeito: ${await restoreCommissionBackfill(b)} itens voltaram ao backup de ${b.criadoEm}.`);
    return;
  }
  if (!flag("--dry-run") && !flag("--aplicar")) throw new Error("Use --dry-run (ensaio) ou --aplicar. Veja o cabeçalho do script.");
  const plan = await planCommissionBackfill();
  report(plan);
  if (flag("--dry-run")) { console.log("\nEnsaio: nada foi gravado."); return; }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const file = value("--backup") ?? path.join(os.homedir(), "backups", `comissao-avec-${stamp}-antes.json`);
  if (existsSync(file)) throw new Error(`O backup ${file} já existe. Escolha outro nome.`);
  await mkdir(path.dirname(file), { recursive: true });
  const res = await applyCommissionBackfill(plan, (b) => writeFile(file, JSON.stringify(b, null, 1), { flag: "wx" }));
  console.log(`\nBackup: ${file}`);
  console.log(`Aplicado: ${res.updated} itens.`);
  const check = await planCommissionBackfill();
  console.log(check.updates.length ? `Ainda há ${check.updates.length} pendências. Rode --dry-run de novo.` : "Conferência: nada pendente.");
  if (check.updates.length) process.exitCode = 1;
  console.log(`\nComo ficou ${plan.conferencia.mes} (tudo o que tem comissão no CRM):`);
  for (const l of await commissionByProfessional(plan.conferencia.mes)) console.log(`  ${l.profissional.padEnd(28)} ${String(l.itens).padStart(5)} itens  ${brl(l.comissaoCents)}`);
}

main().then(() => pool.end()).catch(async (e) => { console.error(e instanceof Error ? e.message : e); await pool.end(); process.exit(1); });
