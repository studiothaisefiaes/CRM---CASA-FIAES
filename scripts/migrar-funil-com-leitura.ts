import "dotenv/config";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { db, pool } from "../src/server/db";
import { moveToKindTx } from "../src/server/domain/deals";
import { applyFunnelMigration, backupSnapshot, migrateStagesConfig, openByStage, planFunnelMigration, type PlanRow, type Target } from "../src/server/domain/funnel-migration";

// Funil novo com a LEITURA HUMANA das conversas (15/10): a regra do Lote 1C erra ~39% das conversas abertas; aqui, quando a leitura
// tem certeza alta ou média, vale a etapa da leitura; nas outras, a regra. Mesmas funções de domínio do 1C (nunca envia mensagem).
// Ensaio:  npx tsx scripts/migrar-funil-com-leitura.ts --mapa etapa-certa.json --dry-run
// Aplicar: npx tsx scripts/migrar-funil-com-leitura.ts --mapa etapa-certa.json --aplicar --backup /home/crm/backups/funil-leitura-AAAA-MM-DD.json

const args = process.argv.slice(2);
const arg = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
type Leitura = { deal: string; etapa_certa: string; certeza: "alta" | "media" | "baixa" };
type Extra = "proposta" | "retorno";
type Row = PlanRow & { extra?: Extra; leitura?: string };

function override(r: PlanRow, etapa: string): { target: Target; extra?: Extra } {
  switch (etapa) {
    case "Agendado": return { target: r.appointmentId ? "agendado" : "fica" };
    case "Atendida": return { target: "atendido" };
    case "Fechado": return { target: "fechado" };
    case "Aguardando cliente": return { target: r.kind === "followup" ? "fica" : "followup" };
    case "Em conversa": return { target: r.kind === "atendimento" ? "fica" : "atendimento" };
    case "Orçamento enviado": return { target: "fica", extra: "proposta" };
    case "Retorno sugerido": return { target: "fica", extra: "retorno" };
    default: return { target: "fica" }; // Novo contato, Perdido (precisa de motivo: a equipe decide), Não é cliente (tratado à parte)
  }
}

async function main() {
  const dry = args.includes("--dry-run"), apply = args.includes("--aplicar");
  const mapa = arg("--mapa"), file = arg("--backup");
  if (dry === apply || !mapa) throw new Error("Use --mapa <etapa-certa.json> e --dry-run, ou --aplicar --backup <arquivo>.");
  if (apply && (!file || existsSync(file))) throw new Error("Informe --backup com um arquivo novo.");
  const leitura = new Map((JSON.parse(await readFile(mapa, "utf8")) as Leitura[]).filter((l) => l.certeza !== "baixa").map((l) => [l.deal, l.etapa_certa]));
  const now = new Date();
  console.log(`Funil novo com a leitura · ${apply ? "APLICANDO" : "ENSAIO"} · leitura confiável para ${leitura.size} conversas\n`);
  console.log("ANTES:"); console.table(await openByStage());
  const plan: Row[] = (await planFunnelMigration(now)).map((r) => {
    const etapa = r.dealId ? leitura.get(r.dealId) : undefined;
    return etapa ? { ...r, ...override(r, etapa), leitura: etapa } : r;
  });
  const resumo = new Map<string, number>();
  for (const r of plan) { const k = `${r.stageName} → ${r.extra ?? r.target}${r.leitura ? " (leitura)" : " (regra)"}`; resumo.set(k, (resumo.get(k) ?? 0) + 1); }
  console.table([...resumo].map(([k, n]) => ({ movimento: k, conversas: n })));
  const manual = plan.filter((r) => r.leitura && ["Perdido", "Novo contato"].includes(r.leitura) || r.leitura?.startsWith("Não é cliente"));
  console.log(`\nPara a equipe olhar (Perdido / Não é cliente / Novo contato, não movidas): ${manual.length}`);
  for (const r of manual) console.log(`  - ${r.name.split(/\s+/)[0]} · ${r.leitura} · ${r.dealId}`);
  if (dry) return;

  await writeFile(file!, JSON.stringify(await backupSnapshot(plan), null, 1), { mode: 0o600 });
  console.log(`\nBackup: ${file}`);
  console.log(`Etapas: ${(await migrateStagesConfig(true)).length} ajuste(s)`);
  const std = await applyFunnelMigration(plan.filter((r) => !r.extra), now);
  let extras = 0; const failed = [...std.failed];
  for (const r of plan.filter((x) => x.extra && x.dealId)) {
    try { await db.transaction((tx) => moveToKindTx(tx, r.dealId!, r.extra!, null, "migracao_leitura_1510", now)); extras++; }
    catch (e) { failed.push({ dealId: r.dealId, name: r.name, error: e instanceof Error ? e.message : String(e) }); }
  }
  console.log(`Movidas pela regra/leitura: ${std.applied} · para Orçamento/Retorno: ${extras}`);
  for (const f of failed) console.log(`  ✗ ${f.name.split(/\s+/)[0]} (${f.dealId}): ${f.error}`);
  console.log("\nDEPOIS:"); console.table(await openByStage());
  if (failed.length) process.exitCode = 1;
}
main().then(() => pool.end()).catch(async (e) => { console.error(e instanceof Error ? e.message : e); await pool.end(); process.exit(1); });
