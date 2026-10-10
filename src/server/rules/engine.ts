import { and, eq, isNull, sql } from "drizzle-orm";
import { db, type Tx } from "../db";
import { alerts, automationRuns, automations, deals, settings, stages, type Automation } from "../db/schema";
import { businessMinutesBetween, isOpen, DEFAULT_HOURS, type BusinessHours } from "../../lib/business-hours";
import { formatPhone } from "../domain/phone";
import { logEvent, emit } from "../domain/events";
import { moveDealTx } from "../domain/deals";
import { getBusinessHours } from "../domain/hours";
import { waitKeyOf } from "./wait-key";
import { actionSchema, conditionSchema, triggerSchema, type Action, type Trigger } from "./types";

export const TZ_OFFSET_MIN = -180; // America/Bahia (UTC-3, sem horário de verão)

type Outbox = { dealId: string; text: string }[];

type Candidate = {
  dealId: string; ownerId: string | null; stageKey: string; stageName: string; contactName: string | null; phone: string;
  windowKey: string; minutes?: number; days?: number; since?: string | Date | null;
  /** Só nos gatilhos de espera: desde quando a cliente aguarda resposta. */
  awaitingSince?: Date;
};

function localDate(d: Date) { return new Date(d.getTime() + TZ_OFFSET_MIN * 60_000); }

export { getBusinessHours };

export async function candidatesFor(trigger: Trigger, now: Date, hours?: BusinessHours): Promise<Candidate[]> {
  const bh = hours ?? (await getBusinessHours());
  const base = sql`select d.id as "dealId", d.owner_id as "ownerId", s.key as "stageKey", s.name as "stageName",
    c.name as "contactName", c.phone_e164 as phone, s.sla_minutes as "slaMinutes"`;
  // Arquivado ("não é cliente") e canal em modo quieto (histórico recém-importado) ficam fora do motor.
  const from = sql`from deals d join stages s on s.id = d.stage_id join contacts c on c.id = d.contact_id
    left join channels ch on ch.id = d.channel_id`;
  const live = sql`d.archived_at is null and (ch.quiet_until is null or ch.quiet_until <= ${now.toISOString()}::timestamptz)`;
  let q;
  switch (trigger.type) {
    case "sem_resposta_minutos":
      // filtrado depois em minutos de expediente
      q = sql`${base}, d.awaiting_reply_since as since ${from}
        where ${live} and d.closed_at is null and d.awaiting_reply_since is not null
          and d.awaiting_reply_since <= ${new Date(now.getTime() - Math.min(trigger.minutes, 1) * 60_000).toISOString()}::timestamptz`;
      break;
    case "parado_dias":
      q = trigger.useStageLimit
        ? sql`${base}, d.stage_entered_at as since ${from}
            where ${live} and d.closed_at is null and s.stale_days is not null and d.stage_entered_at <= ${now.toISOString()}::timestamptz - make_interval(days => s.stale_days)`
        : sql`${base}, d.stage_entered_at as since ${from}
            where ${live} and d.closed_at is null and d.stage_entered_at <= ${new Date(now.getTime() - trigger.days * 86_400_000).toISOString()}::timestamptz`;
      break;
    case "sem_retorno_cliente_dias":
      q = sql`${base}, d.stage_entered_at as since ${from}
        where ${live} and d.closed_at is null and d.awaiting_reply_since is null and d.last_outbound_at is not null
          and (d.last_inbound_at is null or d.last_inbound_at < d.last_outbound_at)
          and d.last_outbound_at <= ${new Date(now.getTime() - trigger.days * 86_400_000).toISOString()}::timestamptz
          and d.stage_entered_at <= ${new Date(now.getTime() - trigger.days * 86_400_000).toISOString()}::timestamptz`;
      break;
    case "aniversario_em_dias": {
      const target = localDate(new Date(now.getTime() + trigger.days * 86_400_000));
      q = sql`${base}, null as since ${from}
        where ${live} and c.birth_month = ${target.getUTCMonth() + 1} and c.birth_day = ${target.getUTCDate()}
          and d.id = (select d2.id from deals d2 where d2.contact_id = c.id order by d2.closed_at nulls first, d2.created_at desc limit 1)`;
      break;
    }
    case "data_cobranca":
      q = sql`${base}, d.charge_at as since ${from}
        where ${live} and d.charge_at is not null and d.charge_at <= ${now.toISOString()}::timestamptz
          and d.charge_at > ${new Date(now.getTime() - 7 * 86_400_000).toISOString()}::timestamptz`;
      break;
    case "agendamento_em_horas":
      q = sql`${base}, d.scheduled_at as since ${from}
        where ${live} and d.closed_at is null and d.scheduled_at is not null and d.scheduled_at > ${now.toISOString()}::timestamptz
          and d.scheduled_at <= ${new Date(now.getTime() + trigger.hours * 3_600_000).toISOString()}::timestamptz`;
      break;
    case "data_recontato":
      q = sql`${base}, d.recontact_at as since ${from}
        where ${live} and d.recontact_at is not null and d.recontact_at <= ${now.toISOString()}::timestamptz
          and d.recontact_at > ${new Date(now.getTime() - 7 * 86_400_000).toISOString()}::timestamptz`;
      break;
  }
  let rows = (await db.execute(q)).rows as (Omit<Candidate, "windowKey"> & { since: string | Date | null; slaMinutes: number | null })[];
  if (trigger.type === "sem_resposta_minutos") {
    // Prazo em minutos de expediente: madrugada e domingo não contam como atraso.
    rows = rows.filter((r) => {
      const limit = trigger.useStageSla ? r.slaMinutes : trigger.minutes;
      if (!limit) return false;
      const waited = businessMinutesBetween(new Date(r.since!).getTime(), now.getTime(), bh);
      (r as { waited?: number }).waited = waited;
      return waited >= limit;
    });
  }
  return rows.map((r) => {
    const since = r.since ? new Date(r.since) : null;
    const elapsedMin = since ? Math.floor((now.getTime() - since.getTime()) / 60_000) : 0;
    let windowKey = "";
    if (trigger.type === "sem_resposta_minutos") windowKey = `espera:${since!.toISOString()}`;
    else if (trigger.type === "parado_dias") windowKey = `etapa:${r.stageKey}:${since!.toISOString()}:${Math.floor(elapsedMin / (trigger.days * 1440))}`;
    else if (trigger.type === "sem_retorno_cliente_dias") windowKey = `silencio:${r.stageKey}:${since!.toISOString()}`;
    else if (trigger.type === "aniversario_em_dias") windowKey = `aniversario:${localDate(now).getUTCFullYear()}`;
    else windowKey = `${trigger.type}:${since!.toISOString()}`;
    const waited = (r as { waited?: number }).waited;
    return { ...r, windowKey, minutes: waited ?? elapsedMin, days: Math.floor(elapsedMin / 1440), ...(trigger.type === "sem_resposta_minutos" && since ? { awaitingSince: since } : {}) };
  });
}

const NEXT_FOLLOWUP: Record<string, string | undefined> = {
  atendimento: "followup_1", followup_1: "followup_2", followup_2: "followup_3", followup_3: "followup_4",
};

function render(tpl: string, c: Candidate, stageName: string) {
  const when = c.since ? new Date(c.since) : null;
  const tz = { timeZone: "America/Bahia" } as const;
  return tpl
    .replaceAll("{data}", when ? when.toLocaleDateString("pt-BR", { ...tz, weekday: "long", day: "2-digit", month: "long" }) : "")
    .replaceAll("{hora}", when ? when.toLocaleTimeString("pt-BR", { ...tz, hour: "2-digit", minute: "2-digit" }) : "")
    .replaceAll("{nome}", c.contactName?.trim() || formatPhone(c.phone))
    .replaceAll("{etapa}", stageName)
    .replaceAll("{minutos}", String(c.minutes ?? 0))
    .replaceAll("{dias}", String(Math.max(1, c.days ?? 0)));
}

async function execute(tx: Tx, a: Action, c: Candidate, auto: Automation, trigger: Trigger, now: Date, ctx: { stageName: string; outbox: Outbox }) {
  const severity = trigger.type === "sem_resposta_minutos" ? "urgente" : "info";
  const dedupeBase = `${auto.id}:${c.dealId}:${c.windowKey}`;
  switch (a.type) {
    case "alertar_responsavel":
    case "alertar_gestao": {
      const audience = a.type === "alertar_gestao" || !c.ownerId ? "gestao" : "responsavel";
      const message = render(a.message, c, ctx.stageName);
      // Espera: um alerta ativo por espera (índice alerts_wait_uq); os demais gatilhos seguem só pela janela.
      const waitKey = c.awaitingSince ? waitKeyOf(c.dealId, c.awaitingSince) : null;
      const [row] = await tx.insert(alerts).values({
        dealId: c.dealId, userId: audience === "responsavel" ? c.ownerId : null, audience, type: trigger.type, severity, message,
        dedupeKey: `${dedupeBase}:${a.type}`, createdAt: now, ...(waitKey ? { waitKey, level: 1 } : {}),
      }).onConflictDoNothing().returning({ id: alerts.id });
      if (row) await logEvent(tx, c.dealId, "alerta", { alertId: row.id, tipo: trigger.type, mensagem: message, para: audience }, c.ownerId);
      return row ? "alerta" : null;
    }
    case "escalar_gestao": {
      // Sobe o alerta da mesma espera para a gestão; sem alerta aberto, cria direto no nível 2.
      if (!c.awaitingSince) return null;
      const waitKey = waitKeyOf(c.dealId, c.awaitingSince);
      const message = render("{nome} está sem resposta há {minutos} min", c, ctx.stageName);
      const [up] = await tx.update(alerts).set({ level: 2, audience: "gestao", escalatedAt: now, message, readAt: null })
        .where(and(eq(alerts.waitKey, waitKey), isNull(alerts.resolvedAt))).returning({ id: alerts.id });
      if (up) { await logEvent(tx, c.dealId, "alerta", { alertId: up.id, tipo: trigger.type, mensagem: message, para: "gestao", escalado: true }, c.ownerId); return "escalado"; }
      const [row] = await tx.insert(alerts).values({
        dealId: c.dealId, userId: null, audience: "gestao", type: trigger.type, severity, message, dedupeKey: `${dedupeBase}:${a.type}`,
        createdAt: now, waitKey, level: 2, escalatedAt: now,
      }).onConflictDoNothing().returning({ id: alerts.id });
      if (row) await logEvent(tx, c.dealId, "alerta", { alertId: row.id, tipo: trigger.type, mensagem: message, para: "gestao", escalado: true }, c.ownerId);
      return row ? "alerta" : null;
    }
    case "mover_para_etapa": {
      await moveDealTx(tx, c.dealId, a.stage, null, `automacao:${auto.key ?? auto.id}`, now);
      const [s] = await tx.select({ name: stages.name }).from(stages).where(eq(stages.key, a.stage));
      ctx.stageName = s?.name ?? a.stage;
      return "movido";
    }
    case "enviar_mensagem": {
      // O envio acontece depois do commit (nunca segurar o lead travado esperando a Evolution).
      ctx.outbox.push({ dealId: c.dealId, text: render(a.message, c, ctx.stageName) });
      return "mensagem";
    }
    case "mover_para_proximo_followup": {
      const next = NEXT_FOLLOWUP[c.stageKey];
      if (!next) return null;
      await moveDealTx(tx, c.dealId, next, null, `automacao:${auto.key ?? auto.id}`, now);
      const [s] = await tx.select({ name: stages.name }).from(stages).where(eq(stages.key, next));
      ctx.stageName = s?.name ?? next;
      return "movido";
    }
  }
}

/** Roda todas as automações ligadas. Idempotente: a mesma janela nunca dispara duas vezes. */
export async function runRules(now = new Date()) {
  const list = await db.select().from(automations).where(eq(automations.enabled, true));
  const summary: { automations: number; fired: number; alerts: number; moved: number; sent?: number; errors: string[]; closed: boolean } = { automations: list.length, fired: 0, alerts: 0, moved: 0, errors: [], closed: false };
  const hours = await getBusinessHours();
  // Fora do expediente nada dispara: os avisos e movimentos esperam a Casa abrir.
  if (!isOpen(now.getTime(), hours)) { summary.closed = true; return summary; }
  const touched = new Set<string>();
  const outbox: Outbox = [];
  for (const auto of list) {
    const trigger = triggerSchema.safeParse(auto.trigger);
    const conds = conditionSchema.array().safeParse(auto.conditions);
    const acts = actionSchema.array().safeParse(auto.actions);
    if (!trigger.success || !conds.success || !acts.success) { summary.errors.push(`${auto.name}: configuração inválida`); continue; }
    let cands = await candidatesFor(trigger.data, now, hours);
    for (const cond of conds.data) if (cond.type === "etapa_em") cands = cands.filter((c) => cond.stages.includes(c.stageKey));
    for (const c of cands) {
      try {
        await db.transaction(async (tx) => {
          // Confere o estado de novo, com o lead travado: se mudou de etapa nesse meio-tempo, não age sobre dado velho.
          const [cur] = await tx.select({ key: stages.key, archivedAt: deals.archivedAt }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId))
            .where(eq(deals.id, c.dealId)).for("update", { of: deals });
          if (!cur || cur.key !== c.stageKey || cur.archivedAt) return;
          const [run] = await tx.insert(automationRuns).values({ automationId: auto.id, dealId: c.dealId, windowKey: c.windowKey, createdAt: now })
            .onConflictDoNothing().returning({ id: automationRuns.id });
          if (!run) return;
          summary.fired++;
          const ctx = { stageName: c.stageName, outbox: [] as Outbox };
          const results: string[] = [];
          for (const a of acts.data) { const r = await execute(tx, a, c, auto, trigger.data, now, ctx); if (r) results.push(r); }
          summary.alerts += results.filter((r) => r === "alerta").length;
          summary.moved += results.filter((r) => r === "movido").length;
          await tx.update(automationRuns).set({ result: { acoes: results } }).where(eq(automationRuns.id, run.id));
          touched.add(c.dealId);
          outbox.push(...ctx.outbox);
        });
      } catch (e) {
        summary.errors.push(`${auto.name} / ${c.dealId}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  for (const m of outbox) {
    try { const { sendAutomated } = await import("../domain/send"); await sendAutomated(m.dealId, m.text); summary.sent = (summary.sent ?? 0) + 1; }
    catch (e) { summary.errors.push(`envio automático ${m.dealId}: ${e instanceof Error ? e.message : e}`); }
  }
  if (touched.size) await emit("regras", { deals: [...touched].slice(0, 50) });
  return summary;
}

