// scripts/importar-servicos-avec.ts
import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pool } from "../src/server/db";
import { applyServiceImport, parseServiceImport, planServiceImport, type ServiceImportPlan } from "../src/server/domain/services-import";

// Serviços do Avec (nome, categoria, preço, duração, descrição) para a aba Serviços. O JSON de entrada é gerado na máquina, a partir
// dos relatórios do Avec, e NÃO fica no repositório. Só acrescenta: cria o que falta e completa o que está vazio; nada é apagado.
// No servidor: cd /opt/crm && sudo -u crm npx tsx scripts/importar-servicos-avec.ts <arquivo.json> <modo>
//   --dry-run                  ensaio: novos, completados, preços diferentes (não troca); não grava nada
//   --aplicar [--backup arq]   grava o backup JSON (estado de antes), aplica numa transação e confere (um segundo ensaio tem de vir vazio)
const args = process.argv.slice(2);
const flag = (k: string) => args.includes(k);
const value = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const brl = (c: number | null | undefined) => (c == null ? "sem preço" : (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const FIELD: Record<string, string> = { priceCents: "preço", category: "categoria", durationMin: "duração", description: "descrição" };

function report(plan: ServiceImportPlan) {
  console.log(`Novos: ${plan.novos.length}`);
  for (const n of plan.novos) console.log(`  + ${n.label} · ${n.category ?? "sem categoria"} · ${brl(n.priceCents)}${n.durationMin ? ` · ${n.durationMin} min` : ""}`);
  console.log(`Completados (só o que estava vazio): ${plan.atualizados.length}`);
  for (const a of plan.atualizados) console.log(`  ~ ${a.label}: ${Object.entries(a.set).map(([k, v]) => `${FIELD[k] ?? k} ${k === "priceCents" ? brl(v as number) : k === "description" ? "(texto)" : v}`).join(", ")}`);
  console.log(`Já iguais: ${plan.iguais}`);
  if (plan.divergencias.length) {
    console.log(`Preço diferente do Avec (o do CRM fica; troque na aba Serviços se for o caso): ${plan.divergencias.length}`);
    for (const d of plan.divergencias) console.log(`  ! ${d.label}: CRM ${brl(d.crmCents)} · Avec ${brl(d.avecCents)}`);
  }
  if (plan.repetidos.length) console.log(`Repetidos no arquivo (ficou o primeiro): ${plan.repetidos.join(", ")}`);
}

async function main() {
  const file = args.find((a) => a.endsWith(".json") && a !== value("--backup"));
  if (!file) throw new Error("Informe o JSON dos serviços: importar-servicos-avec.ts <arquivo.json> --dry-run");
  if (!flag("--dry-run") && !flag("--aplicar")) throw new Error("Use --dry-run (ensaio) ou --aplicar. Veja o cabeçalho do script.");
  const rows = parseServiceImport(JSON.parse(await readFile(file, "utf8")));
  console.log(`Arquivo: ${path.basename(file)} (${rows.length} serviços)\n`);
  const plan = await planServiceImport(rows);
  report(plan);
  if (flag("--dry-run")) { console.log("\nEnsaio: nada foi gravado."); return; }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const backup = value("--backup") ?? path.join(os.homedir(), "backups", `servicos-avec-${stamp}-antes.json`);
  if (existsSync(backup)) throw new Error(`O backup ${backup} já existe. Escolha outro nome.`);
  await mkdir(path.dirname(backup), { recursive: true });
  const res = await applyServiceImport(plan, (b) => writeFile(backup, JSON.stringify(b, null, 1), { flag: "wx" }));
  console.log(`\nBackup: ${backup}`);
  console.log(`Aplicado: ${res.criados} novos, ${res.atualizados} completados.`);
  const check = await planServiceImport(rows);
  const left = check.novos.length + check.atualizados.length;
  console.log(left ? `Ainda há ${left} pendências. Rode --dry-run de novo.` : "Conferência: nada pendente.");
  if (left) process.exitCode = 1;
}

main().then(() => pool.end()).catch(async (e) => { console.error(e instanceof Error ? e.message : e); await pool.end(); process.exit(1); });
