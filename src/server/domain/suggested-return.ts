import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, type Tx } from "../db";
import { auditLog, contacts, deals, lists, settings } from "../db/schema";
import { cancelOpenTasksByOriginTx, createTaskTx, setNextActionTx } from "./tasks";
import { emit, logEvent } from "./events";
import { UserFacingError } from "./errors";
import { findOpenDeal, moveToKindTx, stageByKind } from "./deals";
import { waitForClientTx } from "./funnel";
import { activeOwnerTx } from "./attempts";
import { syncContactFunnelTx } from "./avec/funnel-sync";
import { getBusinessHours } from "./hours";
import { windowOfInstant } from "../../lib/business-hours";
import { bahiaAt } from "../../lib/next-action";
import { FUTURE_HORIZON_DAYS, RETURN_GONE, bahiaDay, reminderDueAt, shortDay } from "../../lib/client-rhythm";
import { clientFirstName } from "../../lib/attempts";

/** Marca no evento da tarefa criada pelo "Lembrar" do bloco Retorno sugerido. */
export const REMIND_META = { origem: "lembrar_retorno" } as const;

/**
 * "Lembrar" (ficha › Retorno sugerido): um combinado do tipo "retorno" para quem tocou, no dia previsto às 10h (já passou ou sem
 * previsão: amanhã 10h) ou na data escolhida. Com conversa aberta, a tarefa fica nela; sem, fica só no contato (aparece no Hoje e
 * abre a ficha). Nunca envia mensagem.
 */
export async function remindReturn(contactId: string, input: { dueAt?: Date | null; dueOn?: string | null }, userId: string, now = new Date()): Promise<{ taskId: string; dueAt: Date }> {
  const dueAt = input.dueAt ?? reminderDueAt(input.dueOn ?? null, now.getTime());
  if (dueAt.getTime() <= now.getTime()) throw new UserFacingError("Essa data já passou. Escolha outra.");
  const t = await db.transaction(async (tx) => {
    const [c] = await tx.select({ name: contacts.name }).from(contacts).where(eq(contacts.id, contactId));
    if (!c) throw new UserFacingError("Esse contato não existe mais.");
    const [open] = await tx.select({ id: deals.id }).from(deals).where(and(eq(deals.contactId, contactId), isNull(deals.closedAt), isNull(deals.archivedAt))).limit(1);
    const title = `Chamar ${clientFirstName(c.name)} para voltar${input.dueOn ? ` (prevista ${shortDay(input.dueOn, bahiaDay(now.getTime()))})` : ""}`;
    return createTaskTx(tx, { dealId: open?.id ?? null, contactId, kind: "retorno", title, dueAt, assigneeId: userId, meta: { ...REMIND_META } }, userId);
  });
  await emit("lead_atualizado", { dealId: t.dealId ?? undefined });
  return { taskId: t.id, dueAt: t.dueAt };
}

/**
 * Retorno sugerido automático (etapa 6 do funil; regra que o Lote 1C deixou para o Lote 2). Desligado até a gestão ligar
 * (Configurações › Automações). Todo dia às 08:00, em dia que a Casa abre, a cliente cuja volta prevista chegou ganha um cartão em
 * "Retorno sugerido" com o combinado "Chamar <nome> para voltar". NUNCA envia mensagem.
 */
export const RETORNO_SETTING = "retorno_sugerido";
export type SuggestedReturnSetting = { ativo: boolean; maxPorDia: number };
export const RETORNO_DEFAULT: SuggestedReturnSetting = { ativo: false, maxPorDia: 20 };
export const RETORNO_ORIGIN = "Retorno sugerido";
export const RETORNO_META = { origem: "retorno_sugerido" } as const;
/** Só quem conversou com a Casa pelo WhatsApp neste período (o espírito da decisão 4: cartão só para quem conversa). */
export const RETORNO_CONVERSA_DIAS = 365;
/** A Casa escreveu e a cliente não respondeu neste tempo: vai para Em conversa esperando a cliente (as tentativas do 1C cuidam do resto). */
export const RETORNO_CASA_ESCREVEU_HORAS = 4;
/** Ninguém da Casa escreveu neste prazo: Perdido "Retorno não feito" (ela continua no filtro Sumidas/Na hora de voltar). */
export const RETORNO_SEM_CONTATO_DIAS = 14;
export const RETORNO_LOST_REASON = "Retorno não feito";

export async function getSuggestedReturnSetting(tx: Tx | typeof db = db): Promise<SuggestedReturnSetting> {
  const [r] = await tx.select().from(settings).where(eq(settings.key, RETORNO_SETTING));
  const v = (r?.value ?? {}) as Partial<SuggestedReturnSetting>;
  const max = Number(v.maxPorDia);
  return { ativo: v.ativo === true, maxPorDia: Number.isInteger(max) && max > 0 && max <= 200 ? max : RETORNO_DEFAULT.maxPorDia };
}

export async function setSuggestedReturnSetting(ativo: boolean, userId: string): Promise<SuggestedReturnSetting> {
  const v = { ...(await getSuggestedReturnSetting()), ativo };
  await db.insert(settings).values({ key: RETORNO_SETTING, value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date() } });
  await db.insert(auditLog).values({ userId, action: ativo ? "ligou" : "desligou", entity: "settings", entityId: RETORNO_SETTING, data: v });
  return v;
}

export type PlannedReturn = { contactId: string; name: string | null; dueOn: string; lastVisitOn: string; everyDays: number };

/**
 * Quem entra hoje (só leitura; o ensaio usa o mesmo): a volta prevista chegou e ela ainda está "na hora" (≤ 1,5× o ritmo); sem horário
 * nos próximos 180 dias; sem conversa aberta; sem cartão de retorno desde a última visita; contato normal (nem "Não é cliente" nem
 * número oculto); conversou com a Casa no último ano. A mais atrasada primeiro.
 */
export async function planSuggestedReturns(now: Date, limit: number): Promise<PlannedReturn[]> {
  const at = now.toISOString();
  const today = sql`((${at}::timestamptz at time zone 'America/Bahia')::date)`;
  const every = sql`coalesce(s.rhythm_days, s.cycle_days)`;
  const rows = (await db.execute(sql`
    select c.id as "contactId", c.name, s.return_due_on as "dueOn", s.last_visit_on as "lastVisitOn", ${every} as "everyDays"
      from contact_stats s join contacts c on c.id = s.contact_id
     where c.kind not in ('fornecedor', 'spam') and c.phone_e164 not like 'lid:%' and c.shares_phone_with is null
       and s.return_due_on is not null and s.return_due_on <= ${today}
       and (${today} - s.last_visit_on) <= ${RETURN_GONE}::numeric * ${every}
       and not exists (select 1 from appointments a where a.contact_id = c.id and a.status in ('agendado', 'confirmado')
                        and a.starts_at > ${at}::timestamptz and a.starts_at <= ${at}::timestamptz + ${FUTURE_HORIZON_DAYS} * interval '1 day')
       and not exists (select 1 from deals d where d.contact_id = c.id and d.closed_at is null and d.archived_at is null)
       and not exists (select 1 from deals d where d.contact_id = c.id and d.origin = ${RETORNO_ORIGIN}
                        and d.created_at >= (s.last_visit_on::timestamp at time zone 'America/Bahia'))
       and exists (select 1 from messages m where m.contact_id = c.id and m.imported_at is null and m.created_at >= ${at}::timestamptz - ${RETORNO_CONVERSA_DIAS} * interval '1 day')
     order by s.return_due_on asc, c.name
     limit ${limit}`)).rows as { contactId: string; name: string | null; dueOn: unknown; lastVisitOn: unknown; everyDays: number }[];
  return rows.map((r) => ({ contactId: r.contactId, name: r.name, dueOn: String(r.dueOn).slice(0, 10), lastVisitOn: String(r.lastVisitOn).slice(0, 10), everyDays: Number(r.everyDays) }));
}

/** Perdido "Retorno não feito" (sem recontato: ela continua nos filtros da lista) e o combinado do retorno cancelado. */
async function loseNoContactTx(tx: Tx, dealId: string, now: Date) {
  await tx.insert(lists).values({ kind: "lost_reason", label: RETORNO_LOST_REASON, position: 99 }).onConflictDoNothing();
  const [reason] = await tx.select({ id: lists.id }).from(lists).where(and(eq(lists.kind, "lost_reason"), eq(lists.label, RETORNO_LOST_REASON)));
  await cancelOpenTasksByOriginTx(tx, dealId, RETORNO_META.origem, null);
  await tx.update(deals).set({ lostReasonId: reason.id }).where(eq(deals.id, dealId));
  await moveToKindTx(tx, dealId, "perdido", null, "retorno_sem_contato", now);
}

export type SweepReturnResult = { criados: number; pelaAgenda: number; aguardando: number; expirados: number; erros: string[]; desligado?: true };
type Counter = "pelaAgenda" | "aguardando" | "expirados";

export async function sweepSuggestedReturns(now = new Date()): Promise<SweepReturnResult> {
  const out: SweepReturnResult = { criados: 0, pelaAgenda: 0, aguardando: 0, expirados: 0, erros: [] };
  const cfg = await getSuggestedReturnSetting();
  if (!cfg.ativo) return { ...out, desligado: true };

  // 1) Os cartões que já estão em Retorno sugerido.
  const open = (await db.execute(sql`
    select d.id, d.contact_id as "contactId", d.stage_entered_at as "enteredAt", d.last_outbound_at as "lastOut", d.last_inbound_at as "lastIn",
           exists (select 1 from messages m where m.deal_id = d.id and m.direction = 'out' and m.status not in ('failed', 'pending')
                    and m.created_at > d.stage_entered_at) as "casaEscreveu"
      from deals d join stages s on s.id = d.stage_id
     where s.kind = 'retorno' and d.closed_at is null and d.archived_at is null`)).rows as
    { id: string; contactId: string; enteredAt: string; lastOut: string | null; lastIn: string | null; casaEscreveu: boolean }[];
  for (const r of open) {
    try {
      const did = await db.transaction(async (tx): Promise<Counter | null> => {
        // Marcou (Avec ou Agenda) → Agendado; veio → Atendida: a mesma regra do Lote 1C.
        const synced = await syncContactFunnelTx(tx, r.contactId, now);
        if (synced.result) { await cancelOpenTasksByOriginTx(tx, r.id, RETORNO_META.origem, null); return "pelaAgenda"; }
        const entered = new Date(r.enteredAt).getTime();
        const lastIn = r.lastIn ? new Date(r.lastIn).getTime() : 0;
        const lastOut = r.lastOut ? new Date(r.lastOut).getTime() : 0;
        if (r.casaEscreveu && lastIn < entered && lastOut <= now.getTime() - RETORNO_CASA_ESCREVEU_HORAS * 3_600_000) {
          await cancelOpenTasksByOriginTx(tx, r.id, RETORNO_META.origem, null);
          await waitForClientTx(tx, r.id, null, "retorno_casa_escreveu", now);
          return "aguardando";
        }
        if (!r.casaEscreveu && entered <= now.getTime() - RETORNO_SEM_CONTATO_DIAS * 86_400_000) {
          await loseNoContactTx(tx, r.id, now);
          return "expirados";
        }
        return null;
      });
      if (did) { out[did]++; await emit("etapa_alterada", { dealId: r.id }); }
    } catch (e) { out.erros.push(`${r.id}: ${e instanceof Error ? e.message : e}`); }
  }

  // 2) Cartões novos: só em dia que a Casa abre e até o teto do dia.
  const hours = await getBusinessHours();
  if (!windowOfInstant(now.getTime(), hours)) return out;
  const [{ n: today }] = (await db.execute(sql`select count(*)::int as n from deals where origin = ${RETORNO_ORIGIN}
      and created_at >= ((${now.toISOString()}::timestamptz at time zone 'America/Bahia')::date::timestamp at time zone 'America/Bahia')`)).rows as { n: number }[];
  const room = cfg.maxPorDia - today;
  if (room <= 0) return out;
  let stage;
  try { stage = await stageByKind("retorno"); } catch { out.erros.push("A etapa Hora de voltar está desativada em Configurações › Etapas."); return out; }
  const todayDay = bahiaDay(now.getTime());
  const dueAt = new Date(Math.max(bahiaAt(now.getTime(), 0, 10).getTime(), now.getTime() + 30 * 60_000)); // hoje 10h (ou daqui a 30 min)
  for (const p of await planSuggestedReturns(now, room)) {
    try {
      const dealId = await db.transaction(async (tx) => {
        await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, p.contactId)).for("update");
        if (await findOpenDeal(p.contactId, tx)) return null; // abriu conversa nesse meio-tempo
        const [last] = await tx.select({ ownerId: deals.ownerId, channelId: deals.channelId }).from(deals)
          .where(eq(deals.contactId, p.contactId)).orderBy(desc(deals.createdAt)).limit(1);
        const ownerId = await activeOwnerTx(tx, last?.ownerId ?? null);
        const [d] = await tx.insert(deals).values({
          contactId: p.contactId, stageId: stage.id, ownerId, channelId: last?.channelId ?? null, origin: RETORNO_ORIGIN, stageEnteredAt: now, createdAt: now,
        }).returning();
        await logEvent(tx, d.id, "lead_criado", { origin: RETORNO_ORIGIN, initialStage: stage.key, retorno: { previsto: p.dueOn, aCadaDias: p.everyDays, ultimaVisita: p.lastVisitOn } });
        await setNextActionTx(tx, d.id, {
          title: `Chamar ${clientFirstName(p.name)} para voltar (prevista ${shortDay(p.dueOn, todayDay)})`, dueAt, assigneeId: ownerId, meta: { ...RETORNO_META },
        }, null, now);
        return d.id;
      });
      if (dealId) { out.criados++; await emit("lead_atualizado", { dealId }); }
    } catch (e) { out.erros.push(`${p.contactId}: ${e instanceof Error ? e.message : e}`); }
  }
  return out;
}
