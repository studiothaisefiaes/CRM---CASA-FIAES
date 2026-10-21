import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { appointments, deals, stages, tasks } from "../db/schema";
import { moveToKindTx } from "./deals";
import { activeOwnerTx, adoptWaitingTx } from "./attempts";
import { closeAsWonTx, enterAttendedTx, waitForClientTx } from "./funnel";
import { applyAppointmentTx, createScheduledDealTx, FUTURE_MAX_DAYS, RECENT_CONVERSATION_DAYS } from "./avec/funnel-sync";
import { setNextActionTx } from "./tasks";
import { clientFirstName } from "../../lib/attempts";

/**
 * Lote 1C: leva as conversas abertas de hoje para o funil novo, seguindo a tabela "Migração" da spec
 * (docs/superpowers/specs/2026-10-15-crm-sistema-completo-design.md). Idempotente: depois de aplicado, um novo plano não move nada.
 * Nunca envia mensagem. Quem chama (scripts/migrar-funil-lote1c.ts) faz o ensaio, o backup JSON e a conferência.
 */
export const MIGRATION_REASON = "migracao_lote1c";
const DAY = 86_400_000;

/* ── 1. Etapas ── */
const RENAMES: [key: string, from: string, to: string][] = [["lead", "Lead", "Novo contato"], ["atendimento", "Atendimento", "Em conversa"], ["followup_1", "Follow-up 1", "Aguardando cliente"]];
const POSITIONS: Record<string, number> = { lead: 0, atendimento: 1, followup_1: 2, orcamento: 3, agendado: 4, atendida: 5, retorno: 6, fechado: 7, perdido: 8, followup_2: 20, followup_3: 21, followup_4: 22 };
const RETIRED = ["followup_2", "followup_3", "followup_4"];
const NEW_KEYS = ["orcamento", "atendida", "retorno"];

/** Nomes, ordem, limite parado e Follow-up 2–4 desativados. Só troca o nome que ainda está no padrão antigo. Devolve o que mudou (ou mudaria). */
export async function migrateStagesConfig(apply: boolean): Promise<string[]> {
  return db.transaction(async (tx) => {
    const byKey = new Map((await tx.select().from(stages)).map((s) => [s.key, s]));
    const missing = NEW_KEYS.filter((k) => !byKey.has(k));
    if (missing.length) throw new Error(`Faltam as etapas ${missing.join(", ")}: rode "npm run db:seed" antes.`);
    const changes: string[] = [];
    const set = async (id: string, patch: Partial<typeof stages.$inferInsert>, text: string) => { changes.push(text); if (apply) await tx.update(stages).set(patch).where(eq(stages.id, id)); };
    for (const [key, from, to] of RENAMES) { const s = byKey.get(key); if (s?.name === from) await set(s.id, { name: to }, `Renomear "${from}" → "${to}"`); }
    for (const [key, pos] of Object.entries(POSITIONS)) { const s = byKey.get(key); if (s && s.position !== pos) await set(s.id, { position: pos }, `Ordem de "${s.name}": ${s.position} → ${pos}`); }
    const atend = byKey.get("atendimento");
    if (atend?.staleDays === 1) await set(atend.id, { staleDays: 2 }, "Limite parado de Em conversa: 1 → 2 dias");
    for (const key of ["followup_1", ...RETIRED]) {
      const s = byKey.get(key);
      if (s && s.staleDays != null) await set(s.id, { staleDays: null }, `Limite parado de "${s.name}": ${s.staleDays} dia(s) → sem limite (as tentativas controlam)`);
    }
    for (const key of RETIRED) {
      const s = byKey.get(key);
      if (!s?.active) continue;
      const [{ n }] = (await tx.execute(sql`select count(*)::int as n from deals where stage_id = ${s.id} and closed_at is null and archived_at is null`)).rows as { n: number }[];
      if (n > 0) throw new Error(`"${s.name}" ainda tem ${n} conversa(s) aberta(s): mova para Aguardando cliente antes.`);
      await set(s.id, { active: false }, `Desativar "${s.name}"`);
    }
    return changes;
  });
}

/* ── 2. Conversas ── */
export type Target = "agendado" | "fechado" | "atendido" | "followup" | "atendimento" | "fica" | "revisar";
export type Situation = "horario_futuro" | "veio_30d_encerrada" | "veio_30d" | "pacote" | "casa_ultimo" | "cliente_ultimo" | "sem_mensagem"
  | "agendado_confere" | "agendado_sem_horario" | "ja_no_funil_novo" | "sem_conversa_aberta";
export type PlanRow = {
  dealId: string | null; contactId: string; name: string; stageKey: string | null; stageName: string; kind: string | null; attempt: number;
  situation: Situation; target: Target; appointmentId: string | null; visitAt: Date | null;
};
type Raw = { kind: string; encerrada: boolean; attempt: number; lastDir: "in" | "out" | null; futureId: string | null; visitAt: Date | null; pacote: boolean };

export const SITUATION_LABEL: Record<Situation, string> = {
  horario_futuro: "tem horário futuro no Avec", veio_30d_encerrada: "veio em 30 dias, conversa resolvida", veio_30d: "veio em 30 dias",
  pacote: "pacote ativo", casa_ultimo: "Casa falou por último", cliente_ultimo: "cliente falou por último", sem_mensagem: "sem mensagem",
  agendado_confere: "horário confere com o Avec", agendado_sem_horario: "sem horário no Avec", ja_no_funil_novo: "já nas etapas novas",
  sem_conversa_aberta: "sem conversa aberta, horário futuro e conversa em 30 dias",
};
export const TARGET_LABEL: Record<Target, string> = {
  agendado: "Agendado (data do Avec)", fechado: "Fechado (ganho)", atendido: "Atendida", followup: "Aguardando cliente, tentativa 1",
  atendimento: "Em conversa + tarefa \"Responder\"", fica: "fica onde está", revisar: "REVISÃO MANUAL",
};

/** A tabela da spec, sem sobreposição: horário futuro > veio em 30 dias > pacote > quem falou por último. */
export function classify(r: Raw): { situation: Situation; target: Target } {
  if (r.kind === "agendado") return r.futureId ? { situation: "agendado_confere", target: "fica" } : { situation: "agendado_sem_horario", target: "revisar" };
  if (r.kind === "proposta" || r.kind === "atendido" || r.kind === "retorno") return { situation: "ja_no_funil_novo", target: "fica" };
  if (r.futureId) return { situation: "horario_futuro", target: "agendado" };
  if (r.visitAt) return r.encerrada ? { situation: "veio_30d_encerrada", target: "fechado" } : { situation: "veio_30d", target: "atendido" };
  const counted = (r.kind === "followup" || r.kind === "atendimento") && r.attempt > 0;
  if (r.pacote) return { situation: "pacote", target: counted ? "fica" : "followup" };
  if (r.lastDir === "out") return { situation: "casa_ultimo", target: counted ? "fica" : "followup" };
  if (r.lastDir === "in") return { situation: "cliente_ultimo", target: r.kind === "followup" ? "atendimento" : "fica" };
  return { situation: "sem_mensagem", target: "fica" };
}

export async function planFunnelMigration(now: Date): Promise<PlanRow[]> {
  const nowIso = now.toISOString();
  const max = new Date(now.getTime() + FUTURE_MAX_DAYS * DAY).toISOString();
  const from30 = new Date(now.getTime() - 30 * DAY).toISOString();
  const recent = new Date(now.getTime() - RECENT_CONVERSATION_DAYS * DAY).toISOString();
  const future = (contact: string) => sql.raw(`(select a.id from appointments a where a.contact_id = ${contact} and a.status in ('agendado', 'confirmado')
    and a.starts_at > '${nowIso}'::timestamptz and a.starts_at <= '${max}'::timestamptz order by a.starts_at limit 1)`);
  const open = (await db.execute(sql`
    select d.id as "dealId", d.contact_id as "contactId", coalesce(nullif(trim(c.name), ''), c.phone_e164) as name, s.key as "stageKey", s.name as "stageName",
      s.kind::text as kind, d.conversation_archived_at is not null as encerrada, d.followup_attempt as attempt,
      (select m.direction::text from messages m where m.deal_id = d.id order by m.created_at desc, m.id desc limit 1) as "lastDir",
      ${future("d.contact_id")} as "futureId",
      (select max(a.starts_at) from appointments a where a.contact_id = d.contact_id and a.status = 'compareceu'
        and a.starts_at > ${from30}::timestamptz and a.starts_at <= ${nowIso}::timestamptz) as "visitAt",
      exists (select 1 from client_packages p where p.contact_id = d.contact_id and p.used_sessions < p.total_sessions
        and (p.valid_until is null or p.valid_until >= (${nowIso}::timestamptz at time zone 'America/Bahia')::date)) as pacote
    from deals d join stages s on s.id = d.stage_id join contacts c on c.id = d.contact_id
    where d.closed_at is null and d.archived_at is null and c.ignored = false
    order by s.position, name`)).rows as (Omit<Raw, "visitAt"> & { visitAt: string | Date | null; dealId: string; contactId: string; name: string; stageKey: string; stageName: string })[];
  const rows: PlanRow[] = open.map((r) => {
    const visitAt = r.visitAt ? new Date(r.visitAt) : null;
    return { dealId: r.dealId, contactId: r.contactId, name: r.name, stageKey: r.stageKey, stageName: r.stageName, kind: r.kind, attempt: r.attempt,
      appointmentId: r.futureId, visitAt, ...classify({ ...r, visitAt }) };
  });
  // Decisão 4: sem conversa aberta, com horário futuro E conversa nos últimos 30 dias → cartão novo em Agendado.
  const loose = (await db.execute(sql`
    select c.id as "contactId", coalesce(nullif(trim(c.name), ''), c.phone_e164) as name, ${future("c.id")} as "futureId"
    from contacts c
    where c.ignored = false
      and not exists (select 1 from deals d where d.contact_id = c.id and d.closed_at is null and d.archived_at is null)
      and exists (select 1 from messages m where m.contact_id = c.id and m.imported_at is null and m.created_at > ${recent}::timestamptz)
      and ${future("c.id")} is not null`)).rows as { contactId: string; name: string; futureId: string }[];
  for (const l of loose) rows.push({ dealId: null, contactId: l.contactId, name: l.name, stageKey: null, stageName: "(sem conversa aberta)", kind: null, attempt: 0,
    situation: "sem_conversa_aberta", target: "agendado", appointmentId: l.futureId, visitAt: null });
  return rows;
}

/** A tabela do ensaio: etapa de hoje × situação × quantas × para onde vai. */
export function summarize(rows: PlanRow[]) {
  const m = new Map<string, { hoje: string; situacao: string; conversas: number; vaiPara: string }>();
  for (const r of rows) {
    const k = `${r.stageName}|${r.situation}|${r.target}`;
    const cur = m.get(k) ?? { hoje: r.stageName, situacao: SITUATION_LABEL[r.situation], conversas: 0, vaiPara: TARGET_LABEL[r.target] };
    cur.conversas++;
    m.set(k, cur);
  }
  return [...m.values()];
}

/** Aplica o plano: uma transação por conversa; um erro não para as outras (volta na lista). */
export async function applyFunnelMigration(rows: PlanRow[], now: Date) {
  let applied = 0;
  const failed: { dealId: string | null; name: string; error: string }[] = [];
  for (const r of rows) {
    if (r.target === "fica" || r.target === "revisar") continue;
    try {
      await db.transaction(async (tx) => {
        const [deal] = r.dealId ? await tx.select().from(deals).where(eq(deals.id, r.dealId)) : [];
        switch (r.target) {
          case "agendado": {
            const [appt] = await tx.select().from(appointments).where(eq(appointments.id, r.appointmentId!));
            if (deal) await applyAppointmentTx(tx, deal, appt, now, MIGRATION_REASON); else await createScheduledDealTx(tx, r.contactId, appt, now);
            break;
          }
          case "fechado":
            await tx.update(deals).set({ attendance: "compareceu", attendanceAt: r.visitAt }).where(eq(deals.id, deal.id));
            await closeAsWonTx(tx, deal.id, null, MIGRATION_REASON, now, { visitAt: r.visitAt });
            break;
          case "atendido":
            await tx.update(deals).set({ attendance: "compareceu", attendanceAt: r.visitAt }).where(eq(deals.id, deal.id));
            await enterAttendedTx(tx, deal.id, null, MIGRATION_REASON, now, { visitAt: r.visitAt ?? undefined, postTask: false });
            break;
          case "followup":
            if (r.kind === "followup") await adoptWaitingTx(tx, deal, "followup", now); // "mantendo a tarefa"
            else await waitForClientTx(tx, deal.id, null, MIGRATION_REASON, now); // nova organização: espera em Em conversa
            break;
          case "atendimento":
            await moveToKindTx(tx, deal.id, "atendimento", null, MIGRATION_REASON, now);
            await setNextActionTx(tx, deal.id, { title: `Responder ${clientFirstName(r.name)}`, dueAt: now, assigneeId: await activeOwnerTx(tx, deal.ownerId) }, null, now);
            break;
        }
      });
      applied++;
    } catch (e) { failed.push({ dealId: r.dealId, name: r.name, error: e instanceof Error ? e.message : String(e) }); }
  }
  return { applied, failed };
}

/** O que guardar ANTES de aplicar: etapas, as conversas abertas (linha inteira), as tarefas abertas delas e o plano. */
export async function backupSnapshot(rows: PlanRow[]) {
  const ids = rows.map((r) => r.dealId).filter((x): x is string => !!x);
  return {
    geradoEm: new Date().toISOString(), lote: "1C",
    stages: await db.select().from(stages),
    deals: ids.length ? await db.select().from(deals).where(inArray(deals.id, ids)) : [],
    tarefasAbertas: ids.length ? await db.select().from(tasks).where(and(inArray(tasks.dealId, ids), isNull(tasks.doneAt))) : [],
    plano: rows,
  };
}

export async function openByStage(): Promise<{ etapa: string; conversas: number }[]> {
  return (await db.execute(sql`select s.name as etapa, count(d.id)::int as conversas from stages s
    left join deals d on d.stage_id = s.id and d.closed_at is null and d.archived_at is null
    where s.active group by s.id order by s.position`)).rows as { etapa: string; conversas: number }[];
}
