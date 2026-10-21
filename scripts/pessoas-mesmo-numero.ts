// scripts/pessoas-mesmo-numero.ts
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pool } from "../src/server/db";
import { applyPeoplePlan, loadNameRows, planFromRows, type PeoplePlan } from "../src/server/domain/pessoas-mesmo-numero";

// Várias pessoas no mesmo número (17/10, caso Cati: mãe e filha no mesmo celular, as duas agendadas no Avec, o CRM só mostrava a mãe).
// A partir do que JÁ foi importado (nomes dos horários, pacotes e usos de pacote de cada contato), acha os números com duas clientes de
// nomes diferentes e cria a pessoa a mais do número, religando os horários (e as visitas inteiras dela), pacotes e usos da pessoa certa.
// Apelido e erro de digitação contam como a mesma pessoa; contato sem nome ou com nome que não bate com o Avec fica "a conferir".
// Precisa da migration 0051. No servidor: cd /opt/crm && sudo -u crm npx tsx scripts/pessoas-mesmo-numero.ts <modo>
//   --dry-run                  ensaio (só leitura): cada número, quem fica no titular, quem vira pessoa a mais e o que vai junto
//   --aplicar [--backup arq]   grava o backup JSON (o dono de cada registro antes), aplica numa transação e confere (o ensaio tem de vir vazio)
//   --pular id8,id8            deixa de fora os números que a Casa conferiu e não quer separar (o código entre colchetes no ensaio)
const args = process.argv.slice(2);
const flag = (k: string) => args.includes(k);
const value = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export function report(plan: PeoplePlan, log: (s: string) => void = console.log) {
  log(`Números com mais de uma pessoa: ${plan.casos.length}`);
  for (const c of plan.casos) {
    log(`  [${c.holderId.slice(0, 8)}] ${c.holderName ?? "(sem nome)"}  (fica: ${c.holderNames.join(" / ")})`);
    for (const p of c.pessoas) {
      const what = [plural(p.horarios, "horário", "horários"), plural(p.pacotes, "pacote", "pacotes"), plural(p.usos, "uso de pacote", "usos de pacote")].join(", ");
      log(`    ${p.personId ? "=" : "+"} ${p.name}${p.names.length > 1 ? `  (${p.names.join(" / ")})` : ""}: ${what}`);
    }
  }
  const novas = plan.casos.flatMap((c) => c.pessoas).filter((p) => !p.personId).length;
  log(`\nPessoas novas: ${novas} · já existentes: ${plan.casos.flatMap((c) => c.pessoas).length - novas}`);
  if (plan.conferir.length) {
    log(`A conferir (não mexe): ${plan.conferir.length}`);
    for (const u of plan.conferir) log(`  ? ${u.holderName ?? "(sem nome)"}: ${u.grupos.join(" / ")} (${u.motivo})`);
  }
}

async function main() {
  if (!flag("--dry-run") && !flag("--aplicar")) throw new Error("Use --dry-run (ensaio) ou --aplicar. Veja o cabeçalho do script.");
  const { rows, existing } = await loadNameRows();
  const skip = (value("--pular") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const plan = planFromRows(rows, existing, skip);
  if (skip.length) console.log(`Pulando: ${skip.join(", ")}\n`);
  report(plan);
  if (flag("--dry-run")) { console.log("\nEnsaio: nada foi gravado."); return; }
  if (!plan.casos.length) { console.log("\nNada a aplicar."); return; }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const backup = value("--backup") ?? path.join(os.homedir(), "backups", `pessoas-mesmo-numero-${stamp}-antes.json`);
  if (existsSync(backup)) throw new Error(`O backup ${backup} já existe. Escolha outro nome.`);
  await mkdir(path.dirname(backup), { recursive: true });
  const res = await applyPeoplePlan(plan, (b) => writeFile(backup, JSON.stringify(b, null, 1), { flag: "wx" }));
  console.log(`\nBackup: ${backup}`);
  console.log(`Aplicado: ${res.pessoasNovas} pessoas novas (${res.pessoasExistentes} já existiam), ${res.horarios} horários, ${res.visitas} visitas, ${res.pacotes} pacotes, ${res.usos} usos religados.`);
  const again = await loadNameRows();
  const left = planFromRows(again.rows, again.existing, skip).casos.length;
  console.log(left ? `Ainda há ${left} números pendentes. Rode --dry-run de novo.` : "Conferência: nada pendente.");
  if (left) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("pessoas-mesmo-numero.ts")) {
  main().then(() => pool.end()).catch(async (e) => { console.error(e instanceof Error ? e.message : e); await pool.end(); process.exit(1); });
}
