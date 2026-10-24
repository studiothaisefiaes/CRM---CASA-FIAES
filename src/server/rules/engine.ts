import { and, eq, isNull, sql } from "drizzle-orm";
import { activeAutomationFilter } from "./retired";
import { db, type Tx } from "../db";
import { alerts, automationRuns, automations, contactNotes, contactTags, deals, stages, tags, type Automation } from "../db/schema";
import { businessMinutesBetween, daysCountingOpenDays, isOpen, type BusinessHours } from "../../lib/business-hours";
import { formatPhone } from "../domain/phone";
import { logEvent, emit } from "../domain/events";
import { moveDealTx } from "../domain/deals";
import { getBusinessHours } from "../domain/hours";
import { waitForClientTx } from "../domain/funnel";
import { waitKeyOf } from "./wait-key";
import { enqueueAutomated } from "../domain/outbox";
import { resolveClientMessageAlerts } from "../domain/client-message-alert";
import { hasOpenAlert } from "../domain/alert-actions";
import { addTagTx, removeTagTx, tagByName } from "../domain/tags";
import { passToTeamTx } from "../domain/teams";
import { assertTransferTarget, transferDealTx } from "../domain/assign";
import { assertFuncaoLigada } from "../domain/funcoes";
import { afterConversationStatus, setConversationStatusTx } from "../domain/conversation-status";
import { alertText, clientLabel } from "../../lib/alert-copy";
import { messageDay, messageHour } from "../../lib/client-link";
import { SATISFACTION_OPTIONS, SURVEY_ALREADY } from "../../lib/after-visit";
import { VIRADA_FALTA, viradaPronta } from "../../lib/virada";
import { actionSchema, conditionSchema, isEventTrigger, triggerSchema, CONFIRMACAO_OPCOES, type Action, type Condition, type Trigger } from "./types";

export const TZ_OFFSET_MIN = -180; // America/Bahia (UTC-3, sem horário de verão)

export type Candidate = {
  dealId: string; contactId: string; ownerId: string | null; stageKey: string; stageName: string; contactName: string | null; phone: string;
  windowKey: string; lastOutboundAt?: string | Date | null; minutes?: number; days?: number; since?: string | Date | null;
  /** Só nos gatilhos de espera: desde quando a cliente aguarda resposta. */
  awaitingSince?: Date;
  /** Dona (nome), aniversário e o prazo que valeu na espera: o texto fixo dos alertas de espera e de aniversário. */
  ownerName?: string | null; birthDay?: number | null; birthMonth?: number | null; limitMinutes?: number | null;
};

function localDate(d: Date) { return new Date(d.getTime() + TZ_OFFSET_MIN * 60_000); }

export { getBusinessHours };

/** "Retomar depois"/próxima ação marcada para a frente: a equipe já decidiu quando voltar a falar; follow-up diário e "parado" não agem antes. */
const noFutureTask = (now: Date) => sql`not exists (select 1 from tasks t where t.deal_id = d.id and t.done_at is null and t.due_at > ${now.toISOString()}::timestamptz)`;

const baseSelect = () => sql`select d.id as "dealId", c.id as "contactId", d.owner_id as "ownerId", s.key as "stageKey", s.name as "stageName",
    c.name as "contactName", c.phone_e164 as phone, s.sla_minutes as "slaMinutes", d.last_outbound_at as "lastOutboundAt",
    (select u.name from users u where u.id = d.owner_id) as "ownerName", c.birth_day as "birthDay", c.birth_month as "birthMonth"`;
// Arquivado, contato "não é cliente" (ignored) e canal em modo quieto (histórico recém-importado) ficam fora do motor.
const baseFrom = () => sql`from deals d join stages s on s.id = d.stage_id join contacts c on c.id = d.contact_id
    left join channels ch on ch.id = d.channel_id`;
// Equipe (número de funcionária), Fornecedor e Spam também: sem prazo, atraso, parado, aniversário nem mensagem automática.
const liveWhere = (now: Date) => sql`d.archived_at is null and d.conversation_archived_at is null and c.kind = 'cliente' and (ch.quiet_until is null or ch.quiet_until <= ${now.toISOString()}::timestamptz)`;

export async function candidatesFor(trigger: Trigger, now: Date, hours?: BusinessHours): Promise<Candidate[]> {
  // Gatilho por acontecimento não tem "quem se encaixa agora": age na hora em que acontece (events.ts).
  if (isEventTrigger(trigger)) return [];
  const bh = hours ?? (await getBusinessHours());
  const base = baseSelect();
  const from = baseFrom();
  const live = liveWhere(now);
  let q;
  switch (trigger.type) {
    case "sem_resposta_minutos":
      // filtrado depois em minutos de expediente
      q = sql`${base}, d.awaiting_reply_since as since ${from}
        where ${live} and d.closed_at is null and d.awaiting_reply_since is not null
          and d.awaiting_reply_since <= ${new Date(now.getTime() - Math.min(trigger.minutes, 1) * 60_000).toISOString()}::timestamptz`;
      break;
    case "parado_dias":
      // Com lembrete marcado para a frente (Retomar depois) não está "parado": a Fila também não mostra como Parado.
      q = trigger.useStageLimit
        ? sql`${base}, d.stage_entered_at as since, s.stale_days as "staleDays" ${from}
            where ${live} and d.closed_at is null and s.stale_days is not null and d.stage_entered_at <= ${now.toISOString()}::timestamptz - make_interval(days => s.stale_days) and ${noFutureTask(now)}`
        : sql`${base}, d.stage_entered_at as since, ${trigger.days}::int as "staleDays" ${from}
            where ${live} and d.closed_at is null and d.stage_entered_at <= ${new Date(now.getTime() - trigger.days * 86_400_000).toISOString()}::timestamptz and ${noFutureTask(now)}`;
      break;
    case "sem_retorno_cliente_dias":
      q = sql`${base}, d.stage_entered_at as since ${from}
        where ${live} and d.closed_at is null and d.awaiting_reply_since is null and d.last_outbound_at is not null
          and (d.last_inbound_at is null or d.last_inbound_at < d.last_outbound_at)
          and d.last_outbound_at <= ${new Date(now.getTime() - trigger.days * 86_400_000).toISOString()}::timestamptz
          and d.stage_entered_at <= ${new Date(now.getTime() - trigger.days * 86_400_000).toISOString()}::timestamptz
          and ${noFutureTask(now)}`;
      break;
    case "casa_falou_por_ultimo_horas":
      // A Casa falou por último e a cliente não voltou (a conta em horas de expediente é feita depois). Com lembrete para a frente, não age.
      q = sql`${base}, d.last_outbound_at as since ${from}
        where ${live} and d.closed_at is null and d.awaiting_reply_since is null and d.last_outbound_at is not null
          and (d.last_inbound_at is null or d.last_inbound_at < d.last_outbound_at)
          and d.last_outbound_at <= ${new Date(now.getTime() - trigger.hours * 3_600_000).toISOString()}::timestamptz
          and ${noFutureTask(now)}`;
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
      // Mãe e filha no mesmo número (0051, 21/10): o horário pode ser de outra pessoa do número; o {nome} é o DELA (a conversa é a do titular).
      // Titular com horário no mesmo instante: vale o dele.
      q = sql`${base}, d.scheduled_at as since,
          (select p.name from appointments a join contacts p on p.id = a.contact_id
            where a.starts_at = d.scheduled_at and a.avec_twin_of is null and a.status in ('agendado', 'confirmado') and (p.id = c.id or p.shares_phone_with = c.id)
            order by (p.id = c.id) desc, a.created_at limit 1) as "personName" ${from}
        where ${live} and d.closed_at is null and d.scheduled_at is not null and d.scheduled_at > ${now.toISOString()}::timestamptz
          and d.scheduled_at <= ${new Date(now.getTime() + trigger.hours * 3_600_000).toISOString()}::timestamptz`;
      break;
    case "data_recontato":
      q = sql`${base}, d.recontact_at as since ${from}
        where ${live} and d.recontact_at is not null and d.recontact_at <= ${now.toISOString()}::timestamptz
          and d.recontact_at > ${new Date(now.getTime() - 7 * 86_400_000).toISOString()}::timestamptz`;
      break;
    default:
      return [];
  }
  let rows = (await db.execute(q)).rows as (Omit<Candidate, "windowKey"> & { since: string | Date | null; slaMinutes: number | null })[];
  if (trigger.type === "sem_resposta_minutos") {
    // Prazo em minutos de expediente: madrugada e domingo não contam como atraso.
    rows = rows.filter((r) => {
      const limit = trigger.useStageSla ? r.slaMinutes : trigger.minutes;
      if (!limit) return false;
      const waited = businessMinutesBetween(new Date(r.since!).getTime(), now.getTime(), bh);
      (r as { waited?: number }).waited = waited;
      (r as { limit?: number }).limit = limit;
      return waited >= limit;
    });
  }
  if (trigger.type === "parado_dias") {
    // Dias com a Casa fechada (domingo e segunda) não contam: a conversa de sábado à tarde não está parada na terça às 9h.
    rows = rows.filter((r) => {
      const d = daysCountingOpenDays(new Date(r.since!).getTime(), now.getTime(), bh);
      (r as { openDays?: number }).openDays = d;
      return d >= Number((r as { staleDays?: number }).staleDays);
    });
  }
  if (trigger.type === "casa_falou_por_ultimo_horas") {
    // Horas de EXPEDIENTE: noite e dias com a Casa fechada não contam.
    rows = rows.filter((r) => businessMinutesBetween(new Date(r.since!).getTime(), now.getTime(), bh) >= trigger.hours * 60);
  }
  return rows.map(({ personName, ...r }: typeof rows[number] & { personName?: string | null }) => {
    if (personName?.trim()) r.contactName = personName;
    const since = r.since ? new Date(r.since) : null;
    const elapsedMin = since ? Math.floor((now.getTime() - since.getTime()) / 60_000) : 0;
    let windowKey = "";
    if (trigger.type === "sem_resposta_minutos") windowKey = `espera:${since!.toISOString()}`;
    // parado: um aviso por permanência na etapa (Lote 1C: nada de repetir todo dia)
    else if (trigger.type === "parado_dias") windowKey = `etapa:${r.stageKey}:${since!.toISOString()}`;
    else if (trigger.type === "sem_retorno_cliente_dias") windowKey = `silencio:${r.stageKey}:${since!.toISOString()}`;
    else if (trigger.type === "casa_falou_por_ultimo_horas") windowKey = `casa_ultima:${since!.toISOString()}`;
    else if (trigger.type === "aniversario_em_dias") windowKey = `aniversario:${localDate(now).getUTCFullYear()}`;
    else windowKey = `${trigger.type}:${since!.toISOString()}`;
    const waited = (r as { waited?: number }).waited;
    return { ...r, windowKey, minutes: waited ?? elapsedMin, days: (r as { openDays?: number }).openDays ?? Math.floor(elapsedMin / 1440), ...(trigger.type === "sem_resposta_minutos" && since ? { awaitingSince: since } : {}),
      ...(trigger.type === "sem_resposta_minutos" ? { limitMinutes: (r as { limit?: number }).limit ?? null } : {}) };
  });
}

/**
 * O lead como candidato de regra (gatilho por acontecimento; a Task 7 também usa), com os mesmos filtros do motor de tempo:
 * arquivado, Spam, Fornecedor, Equipe e canal em modo quieto ficam de fora (null). `windowKey` vem vazio: quem chama preenche.
 */
export async function candidateForDeal(dealId: string, now = new Date()): Promise<Candidate | null> {
  const r = await db.execute(sql`${baseSelect()}, null as since ${baseFrom()} where d.id = ${dealId} and ${liveWhere(now)}`);
  const row = r.rows[0] as (Omit<Candidate, "windowKey"> & { slaMinutes?: number | null }) | undefined;
  if (!row) return null;
  return { ...row, windowKey: "", minutes: 0, days: 0 };
}

/** O "Se" da regra: etapa, Casa aberta/fechada em `at` (com Dias especiais) e etiqueta da cliente. Todas precisam valer. */
export async function conditionsHold(conds: Condition[], c: Pick<Candidate, "stageKey" | "contactId">, at: Date, hours: BusinessHours): Promise<boolean> {
  for (const cond of conds) {
    if (cond.type === "etapa_em" && !cond.stages.includes(c.stageKey)) return false;
    if (cond.type === "casa_aberta" && isOpen(at.getTime(), hours) !== cond.aberta) return false;
    if (cond.type === "tem_etiqueta") {
      const [has] = await db.select({ id: contactTags.tagId }).from(contactTags).innerJoin(tags, eq(tags.id, contactTags.tagId))
        .where(and(eq(contactTags.contactId, c.contactId), sql`lower(${tags.name}) = lower(${cond.tag.trim()})`)).limit(1);
      if (!!has !== cond.tem) return false;
    }
  }
  return true;
}

/**
 * Teto de idade dos envios automáticos: ligar uma automação não pode disparar mensagem para o histórico antigo.
 * Silêncio da cliente: no máximo 7 dias depois do limiar; espera sem resposta: no máximo 24 h. Alertas internos não passam por aqui.
 */
export const SEND_MAX_AGE_SILENCE_MS = 7 * 86_400_000;
export const SEND_MAX_AGE_WAIT_MS = 24 * 3_600_000;
export function tooOldForSend(trigger: Trigger, c: Pick<Candidate, "since" | "awaitingSince" | "lastOutboundAt">, now: Date): boolean {
  if (trigger.type === "sem_resposta_minutos") return !!c.awaitingSince && now.getTime() - c.awaitingSince.getTime() > SEND_MAX_AGE_WAIT_MS;
  if (trigger.type === "sem_retorno_cliente_dias") {
    const base = Math.max(c.since ? new Date(c.since).getTime() : 0, c.lastOutboundAt ? new Date(c.lastOutboundAt).getTime() : 0);
    return base > 0 && now.getTime() > base + trigger.days * 86_400_000 + SEND_MAX_AGE_SILENCE_MS;
  }
  return false;
}

/** Texto para a cliente: sem nome cadastrado, "Oi, {nome}!" vira "Oi!" (nunca o telefone no lugar). */
function renderForClient(tpl: string, c: Candidate, stageName: string) {
  const hasName = !!c.contactName?.trim();
  const t = hasName ? tpl : tpl.replace(/,?\s*\{nome\}/g, "").replace(/\{nome\}/g, "").replace(/ {2,}/g, " ").replace(/\s+([!?.,])/g, "$1");
  return render(t, c, stageName);
}

/** {data} e {hora} como no lembrete da Casa (21/10): "quinta-feira, 22/10" e "14h", no relógio de Salvador. */
function render(tpl: string, c: Candidate, stageName: string) {
  const when = c.since ? new Date(c.since) : null;
  return tpl
    .replaceAll("{data}", when ? messageDay(when) : "")
    .replaceAll("{hora}", when ? messageHour(when) : "")
    .replaceAll("{nome}", c.contactName?.trim() || formatPhone(c.phone))
    .replaceAll("{etapa}", stageName)
    .replaceAll("{minutos}", String(c.minutes ?? 0))
    .replaceAll("{dias}", String(Math.max(1, c.days ?? 0)));
}

/** O texto do alerta: espera e aniversário têm frase fixa (alert-copy, igual nas duas automações de espera); as outras usam o modelo configurado. */
function alertMessage(trigger: Trigger, tpl: string, c: Candidate, stageName: string, now: Date): string {
  const client = clientLabel(c.contactName, c.phone);
  if (trigger.type === "sem_resposta_minutos" && c.awaitingSince)
    return alertText.wait({ client, sinceMs: c.awaitingSince.getTime(), slaMinutes: c.limitMinutes ?? null, ownerName: c.ownerName ?? null, now: now.getTime() });
  if (trigger.type === "aniversario_em_dias" && c.birthDay && c.birthMonth) return alertText.birthday(client, c.birthDay, c.birthMonth);
  return render(tpl, c, stageName);
}
const escalatedMessage = (c: Candidate, now: Date) =>
  alertText.escalated({ client: clientLabel(c.contactName, c.phone), sinceMs: c.awaitingSince!.getTime(), ownerName: c.ownerName ?? null, now: now.getTime() });

/** Sobe o alerta da mesma espera para a gestão (nível 2); sem alerta aberto, cria direto no nível 2. */
async function escalate(tx: Tx, c: Candidate, trigger: Trigger, now: Date, message: string, dedupeKey: string) {
  if (!c.awaitingSince) return null;
  const waitKey = waitKeyOf(c.dealId, c.awaitingSince);
  const [up] = await tx.update(alerts).set({ level: 2, audience: "gestao", escalatedAt: now, message, readAt: null, pushedAt: null })
    .where(and(eq(alerts.waitKey, waitKey), isNull(alerts.resolvedAt))).returning({ id: alerts.id });
  if (up) { await logEvent(tx, c.dealId, "alerta", { alertId: up.id, tipo: trigger.type, mensagem: message, para: "gestao", escalado: true }, c.ownerId); return "escalado"; }
  const [row] = await tx.insert(alerts).values({
    dealId: c.dealId, userId: null, audience: "gestao", type: trigger.type, severity: "urgente", message, dedupeKey,
    createdAt: now, waitKey, level: 2, escalatedAt: now,
  }).onConflictDoNothing().returning({ id: alerts.id });
  if (row) await logEvent(tx, c.dealId, "alerta", { alertId: row.id, tipo: trigger.type, mensagem: message, para: "gestao", escalado: true }, c.ownerId);
  if (row) await resolveClientMessageAlerts(c.dealId, now, tx);
  return row ? "alerta" : null;
}

/** Corta em `max` caracteres com reticências. */
const fit = (text: string, max: number) => (text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text);

/** Quando a ação que envia sai: agora (fila sem espera) ou `delayMinutes` depois do disparo. */
const notBeforeOf = (delayMinutes: number | undefined, now: Date) => (delayMinutes ? new Date(now.getTime() + delayMinutes * 60_000) : undefined);

/**
 * Contexto de uma execução: o nome da etapa de agora (mover muda) e o que fazer depois do commit (avisar as telas, mensagem de encerramento).
 * `c.ownerId` também acompanha a regra: depois de "Passar para", o alerta seguinte vai para a nova dona.
 */
export type ExecCtx = { stageName: string; after?: (() => Promise<unknown>)[] };

export async function execute(tx: Tx, a: Action, c: Candidate, auto: Automation, trigger: Trigger, now: Date, ctx: ExecCtx) {
  const severity = trigger.type === "sem_resposta_minutos" ? "urgente" : "info";
  const dedupeBase = `${auto.id}:${c.dealId}:${c.windowKey}`;
  switch (a.type) {
    case "alertar_responsavel":
    case "alertar_gestao": {
      // Espera: um alerta ativo por espera. Avisar a gestão é escalar o alerta da espera (nunca um no-op silencioso).
      if (c.awaitingSince && a.type === "alertar_gestao") return escalate(tx, c, trigger, now, escalatedMessage(c, now), `${dedupeBase}:${a.type}`);
      const audience = a.type === "alertar_gestao" || !c.ownerId ? "gestao" : "responsavel";
      const message = alertMessage(trigger, a.message, c, ctx.stageName, now);
      const waitKey = c.awaitingSince ? waitKeyOf(c.dealId, c.awaitingSince) : null; // índice alerts_wait_uq
      // Fadiga de alerta (20/10): fora a espera, no máximo um aviso aberto por conversa e por motivo. O de antes continua valendo (e sobe em degraus).
      if (!waitKey && await hasOpenAlert(tx, c.dealId, trigger.type, `${auto.id}:`)) return null;
      const [row] = await tx.insert(alerts).values({
        dealId: c.dealId, userId: audience === "responsavel" ? c.ownerId : null, audience, type: trigger.type, severity, message,
        dedupeKey: `${dedupeBase}:${a.type}`, createdAt: now, ...(waitKey ? { waitKey, level: 1 } : {}),
      }).onConflictDoNothing().returning({ id: alerts.id });
      if (row) await logEvent(tx, c.dealId, "alerta", { alertId: row.id, tipo: trigger.type, mensagem: message, para: audience }, c.ownerId);
      // A espera passou do prazo: o aviso de atraso substitui o "Fulana escreveu" no sino (um aviso só por conversa).
      if (row && c.awaitingSince) await resolveClientMessageAlerts(c.dealId, now, tx);
      return row ? "alerta" : null;
    }
    case "escalar_gestao":
      if (!c.awaitingSince) return null;
      return escalate(tx, c, trigger, now, escalatedMessage(c, now), `${dedupeBase}:${a.type}`);
    case "mover_para_etapa": {
      await moveDealTx(tx, c.dealId, a.stage, null, `automacao:${auto.key ?? auto.id}`, now);
      const [s] = await tx.select({ name: stages.name }).from(stages).where(eq(stages.key, a.stage));
      ctx.stageName = s?.name ?? a.stage;
      return "movido";
    }
    case "enviar_mensagem":
    case "enviar_enquete_confirmacao": {
      if (tooOldForSend(trigger, c, now)) return "antigo"; // histórico: ligar a automação não dispara para ele
      // Só entra na fila, na mesma transação da execução: quem envia é o worker (teto por hora, reconferências na hora de enviar).
      const source = `automacao:${auto.id}`;
      // Lembrete de agendamento: guarda o horário e a etapa de agora; a fila cancela se mudarem até a hora de enviar.
      const guard = trigger.type === "agendamento_em_horas" ? { scheduledAt: c.since ? new Date(c.since) : null, stage: c.stageKey } : undefined;
      if (a.type === "enviar_mensagem") await enqueueAutomated({ dealId: c.dealId, kind: "text", text: fit(renderForClient(a.message, c, ctx.stageName), 4000), source, guard, notBefore: notBeforeOf(a.delayMinutes, now) }, tx);
      // Título da enquete: o WhatsApp aceita 255; depois das variáveis pode passar, então corta (nunca lança dentro da transação do motor).
      else await enqueueAutomated({ dealId: c.dealId, kind: "poll", text: fit(renderForClient(a.message, c, ctx.stageName), 255), options: [CONFIRMACAO_OPCOES.confirmo, CONFIRMACAO_OPCOES.remarcar], source, guard }, tx);
      return "mensagem";
    }
    case "aguardar_cliente":
    case "mover_para_proximo_followup": {
      // Os dois viram "esperando a cliente" (nova organização, 16/10): a conversa fica em Em conversa e as tentativas começam ali.
      // Só age em Novo contato / Em conversa sem tentativas; quem já espera (ou está agendada, atendida…) fica.
      const [cur] = await tx.select({ kind: stages.kind, attempt: deals.followupAttempt }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, c.dealId));
      if (cur?.kind !== "lead" && cur?.kind !== "atendimento") return null;
      if (cur.attempt > 0) return null;
      const moved = await waitForClientTx(tx, c.dealId, null, `automacao:${auto.key ?? auto.id}`, now);
      const [s] = await tx.select({ name: stages.name }).from(stages).where(eq(stages.id, moved.stageId));
      ctx.stageName = s?.name ?? ctx.stageName;
      return "movido";
    }
    /* Fase B, Task 7. As ações internas valem mesmo com as Automáticas pausadas (a pausa só segura o que sai para a cliente, na fila). */
    case "por_etiqueta": {
      // Sem disparar regra de etiqueta (o mesmo que addTag com byRule: sem laço A→B→A), dentro da transação da regra.
      const { added } = await addTagTx(tx, c.contactId, a.tag, null);
      return added ? "etiqueta" : null;
    }
    case "tirar_etiqueta": {
      const t = await tagByName(tx, a.tag);
      return t && (await removeTagTx(tx, c.contactId, t.id, null)) ? "etiqueta" : null;
    }
    case "passar_para": {
      if ("team" in a.to) {
        await assertFuncaoLigada("setores");
        c.ownerId = await passToTeamTx(tx, c.dealId, a.to.team, null, now);
      } else {
        const [cur] = await tx.select({ ownerId: deals.ownerId }).from(deals).where(eq(deals.id, c.dealId));
        if (cur?.ownerId === a.to.user) return null; // já é dela: nada de aviso "te passou"
        await assertTransferTarget(tx, a.to.user);
        await transferDealTx(tx, c.dealId, a.to.user, null);
        c.ownerId = a.to.user;
      }
      ctx.after?.push(() => emit("lead_atualizado", { dealId: c.dealId }), () => emit("alerta", { dealId: c.dealId }));
      return "passado";
    }
    case "escrever_nota": {
      await tx.insert(contactNotes).values({ contactId: c.contactId, dealId: c.dealId, authorName: `Regra: ${auto.name}`, source: "regra", body: a.text.trim(), createdAt: now });
      ctx.after?.push(() => emit("nota_criada", { dealId: c.dealId }));
      return "nota";
    }
    case "enviar_arquivo": {
      if (tooOldForSend(trigger, c, now)) return "antigo";
      const guard = trigger.type === "agendamento_em_horas" ? { scheduledAt: c.since ? new Date(c.since) : null, stage: c.stageKey } : undefined;
      // Legenda vazia = sem legenda (a fila guarda a intenção em options.caption). Arquivo apagado da Biblioteca: erro desta ação.
      const caption = a.caption?.trim() ? fit(renderForClient(a.caption, c, ctx.stageName), 1000) : "";
      await enqueueAutomated({ dealId: c.dealId, kind: "media", fileId: a.fileId, text: caption, source: `automacao:${auto.id}`, guard, notBefore: notBeforeOf(a.delayMinutes, now) }, tx);
      return "mensagem";
    }
    case "mudar_status": {
      const r = await setConversationStatusTx(tx, c.dealId, a.status, null, now); // ator nulo = Sistema
      if (!r.changed) return null;
      ctx.after?.push(() => afterConversationStatus(c.dealId, r));
      return "status";
    }
    case "pedir_avaliacao": {
      // Pesquisa de satisfação (Task 9): só com o Depois do atendimento no modo pesquisa e a Virada feita (ruling R7).
      // Fora dele, erro desta ação (registrado na regra); as outras ações seguem.
      if (tooOldForSend(trigger, c, now)) return "antigo";
      const { getAfterVisit, lastConcludedVisit, surveyTitle, visitSurveyTaken } = await import("../domain/after-visit");
      const cfg = await getAfterVisit(tx);
      if (cfg.mode !== "pesquisa") throw new Error("Ligue a Pesquisa de satisfação em Depois do atendimento.");
      // Ruling R7 (Task 10): só com a Virada do Depois do atendimento feita (o agradecimento do Avec desligado).
      const { getVirada } = await import("../domain/virada");
      if (!viradaPronta("depois", (await getVirada("depois", tx))?.marcados ?? [])) throw new Error(VIRADA_FALTA.depois);
      // Uma pesquisa só por visita: a visita de referência (a última Finalizada) já tem a do Depois do atendimento ou de outra regra.
      const visitId = await lastConcludedVisit(c.contactId, now, tx);
      if (visitId && await visitSurveyTaken(tx, visitId)) throw new Error(SURVEY_ALREADY);
      await enqueueAutomated({ dealId: c.dealId, kind: "poll", text: surveyTitle(cfg, c.contactName), options: [...SATISFACTION_OPTIONS], source: `automacao:${auto.id}`,
        ...(visitId ? { guard: { visitId } } : {}) }, tx);
      return "mensagem";
    }
  }
}

export type FireResult = { results: string[]; errors: string[] };

/**
 * Executa as ações de uma regra num lead, numa transação: lead travado e conferido de novo (mudou de etapa ou foi arquivado: não age),
 * `automation_runs` único por (regra, lead, janela). Cada ação roda num savepoint: a que der erro vira uma linha em `errors` (com a mensagem),
 * não desfaz as anteriores e as seguintes continuam. Devolve os resultados e os erros, ou null se não agiu (janela já usada).
 * Depois do commit, roda o que as ações deixaram para depois (avisar as telas, mensagem de encerramento).
 */
export async function fireRule(auto: Automation, trigger: Trigger, acts: Action[], c: Candidate, now: Date): Promise<FireResult | null> {
  const after: (() => Promise<unknown>)[] = [];
  const out = await db.transaction(async (tx) => {
    // Confere o estado de novo, com o lead travado: se mudou de etapa nesse meio-tempo, não age sobre dado velho.
    const [cur] = await tx.select({ key: stages.key, archivedAt: deals.archivedAt }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId))
      .where(eq(deals.id, c.dealId)).for("update", { of: deals });
    if (!cur || cur.key !== c.stageKey || cur.archivedAt) return null;
    const [run] = await tx.insert(automationRuns).values({ automationId: auto.id, dealId: c.dealId, windowKey: c.windowKey, createdAt: now })
      .onConflictDoNothing().returning({ id: automationRuns.id });
    if (!run) return null;
    const ctx: ExecCtx = { stageName: c.stageName, after };
    const results: string[] = [];
    const errors: string[] = [];
    for (const a of acts) {
      const mark = after.length;
      try {
        const r = await tx.transaction((sp) => execute(sp, a, c, auto, trigger, now, ctx));
        if (r) results.push(r);
      } catch (e) {
        after.length = mark; // o que a ação desfeita deixou para depois não roda
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    await tx.update(automationRuns).set({ result: { acoes: results, ...(errors.length ? { erros: errors } : {}) } }).where(eq(automationRuns.id, run.id));
    return { results, errors };
  });
  if (out) for (const fn of after) {
    try { await fn(); } catch (e) { console.error("[regras] depois do commit", c.dealId, e instanceof Error ? e.message : e); }
  }
  return out;
}

/**
 * Automação que não roda (configuração inválida ou busca que quebra): a gestão fica sabendo, uma vez por dia. Antes ficava só no log do
 * servidor. Sem o texto do erro (o do banco pode trazer dados da cliente nos parâmetros); o erro completo continua no log.
 */
async function warnBrokenAutomation(auto: Automation, why: string, now: Date) {
  const day = new Date(now.getTime() - 3 * 3600_000).toISOString().slice(0, 10); // dia em Salvador (UTC-3 fixo)
  await db.insert(alerts).values({ audience: "gestao", type: "automacao_falhou", severity: "info",
    message: `A automação "${auto.name}" não está rodando: ${why}. Confira em Configurações › Automações ou avise quem cuida do sistema.`,
    dedupeKey: `automacao:${auto.id}:${day}` }).onConflictDoNothing()
    .catch((e) => console.error("[regras] não avisou a automação quebrada", e instanceof Error ? e.message : e));
}

/** Roda todas as automações ligadas (as aposentadas nunca, mesmo que tenham ficado ligadas). Idempotente: a mesma janela nunca dispara duas vezes. */
export async function runRules(now = new Date()) {
  const list = await db.select().from(automations).where(and(eq(automations.enabled, true), activeAutomationFilter()));
  const summary: { automations: number; fired: number; alerts: number; moved: number; sent?: number; errors: string[]; closed: boolean } = { automations: list.length, fired: 0, alerts: 0, moved: 0, errors: [], closed: false };
  const hours = await getBusinessHours();
  // Fora do expediente nada dispara: os avisos e movimentos esperam a Casa abrir.
  if (!isOpen(now.getTime(), hours)) { summary.closed = true; return summary; }
  const touched = new Set<string>();
  for (const auto of list) {
    const trigger = triggerSchema.safeParse(auto.trigger);
    const conds = conditionSchema.array().safeParse(auto.conditions);
    const acts = actionSchema.array().safeParse(auto.actions);
    if (!trigger.success || !conds.success || !acts.success) { summary.errors.push(`${auto.name}: configuração inválida`); await warnBrokenAutomation(auto, "a configuração está incompleta", now); continue; }
    // Gatilho por acontecimento (palavra, contato novo, ligação perdida, mídia, etiqueta) roda na hora em que acontece, nunca aqui.
    if (isEventTrigger(trigger.data)) continue;
    // Uma automação cuja busca quebra vai para o resumo; as outras (e as varreduras do worker depois) seguem.
    let cands: Candidate[];
    try { cands = await candidatesFor(trigger.data, now, hours); }
    catch (e) { summary.errors.push(`${auto.name}: ${e instanceof Error ? e.message : e}`); await warnBrokenAutomation(auto, "deu erro ao procurar as conversas", now); continue; }
    for (const cond of conds.data) if (cond.type === "etapa_em") cands = cands.filter((c) => cond.stages.includes(c.stageKey));
    const others = conds.data.filter((x) => x.type !== "etapa_em");
    for (const c of cands) {
      try {
        if (others.length && !(await conditionsHold(others, c, now, hours))) continue;
        const fired = await fireRule(auto, trigger.data, acts.data, c, now);
        if (!fired) continue;
        const { results } = fired;
        for (const err of fired.errors) summary.errors.push(`${auto.name} / ${c.dealId}: ${err}`);
        summary.fired++;
        summary.alerts += results.filter((r) => r === "alerta").length;
        summary.moved += results.filter((r) => r === "movido").length;
        summary.sent = (summary.sent ?? 0) + results.filter((r) => r === "mensagem").length; // enfileiradas; a fila é que envia
        touched.add(c.dealId);
      } catch (e) {
        summary.errors.push(`${auto.name} / ${c.dealId}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  if (touched.size) await emit("regras", { deals: [...touched].slice(0, 50) });
  return summary;
}

