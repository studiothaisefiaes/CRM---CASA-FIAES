// scripts/autoria-assinaturas.ts
import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pool } from "../src/server/db";
import { emit } from "../src/server/domain/events";
import { signatureMap } from "../src/server/domain/authorship";
import { applyBackfill, planBackfill, restoreBackfill, type BackfillBackup, type BackfillPlan, type OwnerReplyRow } from "../src/server/domain/authorship-backfill";

// Lote 1A: autora pela assinatura "*NOME - CASA FIAES:*" nas mensagens antigas e dona para as conversas abertas sem dona.
// No servidor: cd /opt/crm && sudo -u crm npx tsx scripts/autoria-assinaturas.ts <modo>
//   --dry-run [--dias 30]                      ensaio: imprime a tabela dona × quem respondeu, antes e depois; não grava nada
//   --aplicar [--dias 30] [--backup arq.json]  grava o backup JSON, aplica numa transação e confere (um segundo ensaio tem de vir vazio)
//   --desfazer arq.json                        volta autora, dona e última resposta ao que estava no backup
const args = process.argv.slice(2);
const flag = (k: string) => args.includes(k);
const value = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };

function printTable(title: string, rows: OwnerReplyRow[]) {
  console.log(`\n${title}`);
  const w1 = Math.max(4, ...rows.map((r) => r.dona.length)), w2 = Math.max(14, ...rows.map((r) => r.respondeu.length));
  console.log(`${"Dona".padEnd(w1)} | ${"Quem respondeu".padEnd(w2)} | Conversas`);
  for (const r of rows) console.log(`${r.dona.padEnd(w1)} | ${r.respondeu.padEnd(w2)} | ${r.conversas}`);
  console.log(`Sem dono: ${rows.filter((r) => r.dona === "Sem dono").reduce((a, r) => a + r.conversas, 0)}`);
}

function report(plan: BackfillPlan) {
  console.log(`Mensagens da Casa desde ${plan.since} e todas as das conversas abertas.`);
  console.log(`Mensagens que ganham autora: ${plan.messages.filter((m) => m.sentByUserId && m.sentByUserId !== m.before.sentByUserId).length}`);
  console.log(`Mensagens que ganham "por onde saiu": ${plan.messages.filter((m) => m.sentVia !== m.before.sentVia).length}`);
  console.log(`Conversas que ganham dona: ${plan.owners.length}`);
  console.log(`Conversas com "quem respondeu por último" atualizado: ${plan.replies.length}`);
  const unk = Object.entries(plan.unknownSignatures);
  if (unk.length) console.log(`Assinaturas que ninguém da equipe usa (ficam sem autora): ${unk.map(([k, n]) => `${k} (${n})`).join(", ")}`);
  printTable("ANTES: dona no CRM × quem respondeu por último (pela assinatura)", plan.before);
  printTable("DEPOIS", plan.after);
}

async function main() {
  if (flag("--desfazer")) {
    const file = value("--desfazer");
    if (!file) throw new Error("Informe o arquivo de backup: --desfazer <arquivo.json>");
    const b = JSON.parse(await readFile(file, "utf8")) as BackfillBackup;
    const r = await restoreBackfill(b);
    await emit("lead_atualizado", {});
    console.log(`Desfeito: ${r.messages} mensagens e ${r.deals} conversas voltaram ao backup de ${b.criadoEm}.`);
    return;
  }
  if (!flag("--dry-run") && !flag("--aplicar")) throw new Error("Use --dry-run (ensaio) ou --aplicar. Veja o cabeçalho do script.");
  const dias = Number(value("--dias") ?? 30);
  if (!Number.isInteger(dias) || dias < 1 || dias > 365) throw new Error("--dias precisa ser um número inteiro de 1 a 365.");
  if ((await signatureMap()).size === 0) throw new Error("Ninguém tem assinatura cadastrada. Cadastre em Configurações › Equipe (ex.: SARA, CATI) antes.");
  const plan = await planBackfill({ days: dias });
  report(plan);
  if (flag("--dry-run")) { console.log("\nEnsaio: nada foi gravado."); return; }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const file = value("--backup") ?? path.join(os.homedir(), "backups", `autoria-assinaturas-${stamp}-antes.json`);
  if (existsSync(file)) throw new Error(`O backup ${file} já existe. Escolha outro nome.`);
  await mkdir(path.dirname(file), { recursive: true });
  const res = await applyBackfill(plan, (b) => writeFile(file, JSON.stringify(b, null, 1), { flag: "wx" }));
  await emit("lead_atualizado", {});
  console.log(`\nBackup: ${file}`);
  console.log(`Aplicado: ${res.messages} mensagens, ${res.owners} donas, ${res.replies} últimas respostas.`);

  const check = await planBackfill({ days: dias });
  printTable("CONFERÊNCIA: como ficou agora", check.before);
  const same = JSON.stringify(check.before) === JSON.stringify(plan.after);
  const pend = check.messages.length + check.owners.length + check.replies.length;
  console.log(same ? "\nA tabela bate com o DEPOIS do ensaio." : "\nAtenção: a tabela não bate com o DEPOIS do ensaio (alguém mexeu durante a aplicação?).");
  if (pend) { console.log(`Ainda há ${pend} pendências. Rode --dry-run de novo.`); process.exitCode = 1; }
  else console.log("Conferência: nada pendente.");
}

main().then(() => pool.end()).catch(async (e) => { console.error(e instanceof Error ? e.message : e); await pool.end(); process.exit(1); });
