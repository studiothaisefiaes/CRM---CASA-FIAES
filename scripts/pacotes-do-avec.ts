// scripts/pacotes-do-avec.ts
import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pool } from "../src/server/db";
import { formatBRL } from "../src/lib/money";
import { applyAvecPackages, loadAvecPackageInput, parseAvecCatalog, planAvecPackages, type AvecCatalogEntry, type AvecPackagePlan } from "../src/server/domain/pacotes-avec";

// Pacotes do Avec para a aba Serviços › Pacotes: cria o catálogo de pacotes (package_defs) a partir dos pacotes vendidos que vieram do
// Avec (client_packages) e liga essas vendas ao pacote (package_def_id), sem mudar mais nada nelas. Opcional: o catálogo de pacotes do
// Avec (JSON gerado na máquina a partir do relatório "Pacotes", NÃO fica no repositório) com nome legível, preço oficial, descrição e
// serviços × sessões; sem ele, vale a venda mais comum. Só acrescenta: o que já existe só é completado onde está vazio. Idempotente.
// No servidor: cd /opt/crm && sudo -u crm npx tsx scripts/pacotes-do-avec.ts [catalogo.json] <modo>
//   --dry-run                  ensaio: pacotes (sessões, preço, validade), completados, divergências, vendas a ligar; não grava nada
//   --aplicar [--backup arq]   grava o backup JSON (estado de antes), aplica numa transação e confere (um segundo ensaio tem de vir vazio)
const args = process.argv.slice(2);
const flag = (k: string) => args.includes(k);
const value = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const brl = (c: number | null) => (c == null ? "sem preço" : formatBRL(c));
const validity = (d: number | null) => (d == null ? "sem validade" : d % 365 === 0 ? `${d / 365} ${d === 365 ? "ano" : "anos"}` : `${d} dias`);
const FIELD: Record<string, string> = { priceCents: "preço", validityDays: "validade", description: "descrição", avecName: "nome no Avec" };

function report(plan: AvecPackagePlan) {
  console.log("Pacotes:");
  for (const r of plan.resumo) {
    const sessions = Math.max(...r.items.map((i) => i.sessions));
    const per = r.priceCents != null && sessions ? ` (${brl(Math.round(r.priceCents / sessions))} por sessão)` : "";
    console.log(`  ${r.existe ? "=" : "+"} ${r.name} · ${sessions} ${sessions === 1 ? "sessão" : "sessões"} · ${brl(r.priceCents)}${per} · ${validity(r.validityDays)} · ${r.vendas} ${r.vendas === 1 ? "venda" : "vendas"} no Avec`);
    console.log(`      ${r.items.map((i, k) => `${i.sessions}× ${r.serviceLabels[k]}`).join(" + ")}${r.avecName !== r.name ? `   [Avec: ${r.avecName}]` : ""}`);
  }
  console.log(`\nNovos: ${plan.criar.length}`);
  console.log(`Completados (só o que estava vazio): ${plan.completar.length}`);
  for (const c of plan.completar) console.log(`  ~ ${c.name}: ${Object.keys(c.set).map((k) => FIELD[k] ?? k).join(", ")}`);
  console.log(`Vendas do Avec a ligar ao pacote: ${plan.ligar.reduce((n, l) => n + l.rowIds.length, 0)}`);
  console.log(`Já iguais: ${plan.iguais}`);
  if (plan.divergencias.length) {
    console.log(`Diferente do CRM (o do CRM fica; troque na aba Serviços se for o caso): ${plan.divergencias.length}`);
    for (const d of plan.divergencias) console.log(`  ! ${d.name}: ${d.campo} CRM ${d.campo === "preço" ? brl(d.crm) : validity(d.crm)} · Avec ${d.campo === "preço" ? brl(d.avec) : validity(d.avec)}`);
  }
  if (plan.avisos.length) { console.log("Avisos:"); for (const a of plan.avisos) console.log(`  · ${a}`); }
}

async function main() {
  if (!flag("--dry-run") && !flag("--aplicar")) throw new Error("Use --dry-run (ensaio) ou --aplicar. Veja o cabeçalho do script.");
  const file = args.find((a) => a.endsWith(".json") && a !== value("--backup"));
  const catalog: AvecCatalogEntry[] = file ? parseAvecCatalog(JSON.parse(await readFile(file, "utf8"))) : [];
  console.log(file ? `Catálogo: ${path.basename(file)} (${catalog.length} pacotes)\n` : "Sem catálogo do Avec: vale a venda mais comum.\n");
  const plan = planAvecPackages(await loadAvecPackageInput(catalog));
  report(plan);
  if (flag("--dry-run")) { console.log("\nEnsaio: nada foi gravado."); return; }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const backup = value("--backup") ?? path.join(os.homedir(), "backups", `pacotes-avec-${stamp}-antes.json`);
  if (existsSync(backup)) throw new Error(`O backup ${backup} já existe. Escolha outro nome.`);
  await mkdir(path.dirname(backup), { recursive: true });
  const res = await applyAvecPackages(plan, (b) => writeFile(backup, JSON.stringify(b, null, 1), { flag: "wx" }));
  console.log(`\nBackup: ${backup}`);
  console.log(`Aplicado: ${res.criados} novos, ${res.completados} completados, ${res.ligados} vendas ligadas.`);
  const check = planAvecPackages(await loadAvecPackageInput(catalog));
  const left = check.criar.length + check.completar.length + check.ligar.length;
  console.log(left ? `Ainda há ${left} pendências. Rode --dry-run de novo.` : "Conferência: nada pendente.");
  if (left) process.exitCode = 1;
}

main().then(() => pool.end()).catch(async (e) => { console.error(e instanceof Error ? e.message : e); await pool.end(); process.exit(1); });
