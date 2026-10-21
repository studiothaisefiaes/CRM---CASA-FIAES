// scripts/migrar-agendados-para-agenda.ts
import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { pool } from "../src/server/db";
import { applyScheduledMigration, planScheduledMigration, undoScheduledMigration, type ScheduledPlan } from "../src/server/domain/agenda/migrate-scheduled";

// Lote 6B: cria na Agenda os horários que hoje estão só no lead (Agendado com horário futuro). Rodar só com o ok do dono (seção 13.3).
// No servidor: cd /opt/crm && sudo -u crm npx tsx scripts/migrar-agendados-para-agenda.ts <modo>
//   --dry-run                     ensaio: lista o que entra e o que fica de fora (e por quê); não grava nada
//   --aplicar --backup arq.json   grava o backup (o plano) ANTES, aplica, completa o backup com os ids criados e confere (o segundo ensaio vem vazio)
//   --desfazer arq.json           tira os horários criados que ninguém mexeu
const args = process.argv.slice(2);
const value = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const HORA = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" });
const MOTIVO = { passou: "já passou (continua no lead)", ja_na_agenda: "já está na Agenda" } as const;

function report(plan: ScheduledPlan) {
  console.log(`Entram na Agenda: ${plan.items.length}`);
  for (const i of plan.items) console.log(`  ${HORA.format(new Date(i.startsAt))}  ${i.clientName} · ${i.serviceLabel}${i.professionalId ? "" : " · sem profissional"}${i.status === "confirmado" ? " · confirmado" : ""}`);
  console.log(`Ficam de fora: ${plan.skipped.length}`);
  for (const s of plan.skipped) console.log(`  ${HORA.format(new Date(s.startsAt))}  ${s.clientName}: ${MOTIVO[s.reason]}`);
}

async function main() {
  if (args.includes("--dry-run")) { report(await planScheduledMigration()); return; }
  if (args.includes("--aplicar")) {
    const file = value("--backup");
    if (!file) throw new Error("Use --aplicar --backup arquivo.json (o backup é obrigatório).");
    if (existsSync(file)) throw new Error(`${file} já existe: escolha outro nome para não perder um backup anterior.`);
    const plan = await planScheduledMigration();
    report(plan);
    await writeFile(file, JSON.stringify({ plan, createdIds: [] }, null, 2));
    const r = await applyScheduledMigration(plan);
    await writeFile(file, JSON.stringify({ plan, createdIds: r.createdIds }, null, 2));
    console.log(`Criados: ${r.createdIds.length} (${r.fitIn} como encaixe). Pulados na hora: ${r.skipped}. Backup: ${file}`);
    const again = await planScheduledMigration();
    if (again.items.length) throw new Error(`Conferência falhou: o segundo ensaio ainda tem ${again.items.length} horário(s).`);
    console.log("Conferência ok: o segundo ensaio veio vazio.");
    return;
  }
  const undo = value("--desfazer");
  if (undo) {
    const { createdIds } = JSON.parse(await readFile(undo, "utf8")) as { createdIds: string[] };
    const r = await undoScheduledMigration(createdIds);
    console.log(`Tirados: ${r.removed}. Mantidos (alguém já mexeu): ${r.kept}.`);
    return;
  }
  console.log("Use --dry-run, --aplicar --backup arq.json ou --desfazer arq.json.");
}

main().then(() => pool.end()).catch(async (e) => { console.error(e instanceof Error ? e.message : e); await pool.end(); process.exit(1); });
