import "dotenv/config";
import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db, pool } from "../src/server/db";
import { automationRuns, automations, deals, tasks } from "../src/server/db/schema";
import { candidatesFor } from "../src/server/rules/engine";
import { actionSchema, conditionSchema, triggerSchema } from "../src/server/rules/types";
import { getBusinessHours } from "../src/server/domain/hours";
import { isOpen } from "../src/lib/business-hours";
import { bahiaAt } from "../src/lib/next-action";

// Ensaio do motor, SÓ LEITURA (nenhuma escrita, nenhum envio): quantos movimentos e avisos as automações LIGADAS gerariam num dia,
// de 5 em 5 min no expediente, com o banco como está agora (não acompanha o que mudaria durante o dia). Conta também os combinados
// (tarefas) que vencem no dia e viram aviso, as Atendidas que fecham sozinhas e as conversas que viram Perdido depois das 3 tentativas.
// Uso: npx tsx scripts/simular-motor.ts [AAAA-MM-DD]   (padrão: amanhã, no fuso de Salvador)

async function main() {
  const arg = process.argv[2];
  const base = arg ? new Date(`${arg}T12:00:00-03:00`) : bahiaAt(Date.now(), 1, 12);
  const start = bahiaAt(base.getTime(), 0, 0), end = bahiaAt(base.getTime(), 1, 0);
  const hours = await getBusinessHours();
  const autos = await db.select().from(automations).where(eq(automations.enabled, true));
  const done = new Set((await db.select({ a: automationRuns.automationId, d: automationRuns.dealId, w: automationRuns.windowKey }).from(automationRuns)).map((r) => `${r.a}|${r.d}|${r.w}`));
  const rows: { Automação: string; Disparos: number; Avisos: number; Movimentos: number }[] = [];
  for (const auto of autos) {
    const trigger = triggerSchema.safeParse(auto.trigger), conds = conditionSchema.array().safeParse(auto.conditions), acts = actionSchema.array().safeParse(auto.actions);
    if (!trigger.success || !conds.success || !acts.success) { rows.push({ Automação: `${auto.key ?? auto.name} (configuração inválida)`, Disparos: 0, Avisos: 0, Movimentos: 0 }); continue; }
    const seen = new Set<string>();
    for (let t = start.getTime(); t < end.getTime(); t += 5 * 60_000) {
      if (!isOpen(t, hours)) continue;
      let c = await candidatesFor(trigger.data, new Date(t), hours);
      for (const cond of conds.data) if (cond.type === "etapa_em") c = c.filter((x) => cond.stages.includes(x.stageKey));
      for (const x of c) { const k = `${auto.id}|${x.dealId}|${x.windowKey}`; if (!done.has(k)) seen.add(k); }
    }
    const alerts = acts.data.filter((a) => a.type.startsWith("alertar_") || a.type === "escalar_gestao").length;
    const moves = acts.data.filter((a) => a.type.startsWith("mover_") || a.type === "aguardar_cliente").length;
    rows.push({ Automação: auto.key ?? auto.name, Disparos: seen.size, Avisos: seen.size * alerts, Movimentos: seen.size * moves });
  }
  const [{ n: combinados }] = (await db.select({ n: sql<number>`count(*)::int` }).from(tasks).leftJoin(deals, eq(deals.id, tasks.dealId))
    .where(and(isNull(tasks.doneAt), gte(tasks.dueAt, start), lt(tasks.dueAt, end), isNull(deals.archivedAt))));
  const [{ n: fecham }] = (await db.execute(sql`select count(*)::int as n from deals d join stages s on s.id = d.stage_id
    where s.kind = 'atendido' and d.closed_at is null and d.archived_at is null
      and d.stage_entered_at + interval '3 days' >= ${start.toISOString()}::timestamptz and d.stage_entered_at + interval '3 days' < ${end.toISOString()}::timestamptz`)).rows as { n: number }[];
  const [{ n: perdem }] = (await db.execute(sql`select count(*)::int as n from deals d join stages s on s.id = d.stage_id
    where s.kind in ('followup', 'proposta') and d.closed_at is null and d.followup_attempt > 3 and d.followup_due_at < ${end.toISOString()}::timestamptz`)).rows as { n: number }[];
  console.log(`Ensaio do motor (só leitura) · ${start.toISOString().slice(0, 10)} (Salvador) · expediente: ${JSON.stringify(hours)}\n`);
  console.table(rows);
  const avisos = rows.reduce((s, r) => s + r.Avisos, 0);
  console.log(`Combinados (tarefas) que vencem no dia e viram aviso: ${combinados}`);
  console.log(`Atendidas que fecham sozinhas (ganho): ${fecham} · Conversas que viram Perdido "Não respondeu mais": ${perdem}`);
  console.log(`\nTOTAL de avisos previstos no dia: ${avisos + combinados} (automações ${avisos} + combinados ${combinados})`);
}
main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
