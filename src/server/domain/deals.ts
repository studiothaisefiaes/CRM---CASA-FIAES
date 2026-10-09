import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db, type Tx } from "../db";
import { alerts, contacts, deals, messages, stages, users, type Stage } from "../db/schema";
import { normalizePhone } from "./phone";
import { emit, logEvent } from "./events";

export const CLOSED_KINDS = ["fechado", "perdido"] as const;

/** O contato já tem outro lead aberto; reabrir este criaria duplicidade. */
export class ReopenConflict extends Error {
  constructor(public openDealId: string) { super("Este contato já tem outro lead em andamento."); }
}

export async function getStages(tx: Tx | typeof db = db): Promise<Stage[]> {
  return tx.select().from(stages).where(eq(stages.active, true)).orderBy(asc(stages.position));
}

export async function stageByKey(key: string, tx: Tx | typeof db = db) {
  const [s] = await tx.select().from(stages).where(eq(stages.key, key)).limit(1);
  if (!s) throw new Error(`Etapa "${key}" não existe`);
  return s;
}

/** Origem do lead a partir do que dá para saber sem perguntar. */
export function detectOrigin(input: { body?: string | null; hasAdReferral?: boolean; isClient?: boolean }): string {
  if (input.hasAdReferral) return "Anúncio";
  if (input.body && /vim\s+(pelo|do|no)\s+insta(gram)?/i.test(input.body)) return "Instagram";
  if (input.body && /vim\s+(pelo|do)\s+site/i.test(input.body)) return "Site";
  if (input.body && /(indica[cç][aã]o|me\s+indicou|indicad[ao])/i.test(input.body)) return "Indicação";
  if (input.isClient) return "Já é cliente";
  return "WhatsApp";
}

/** Distribui o lead para quem atende com menos leads abertos (rodízio por carga). */
async function pickOwner(tx: Tx): Promise<string | null> {
  const rows = await tx.execute(sql`
    select u.id, count(d.id)::int as open
    from users u
    left join deals d on d.owner_id = u.id and d.closed_at is null
    where u.active and u.role = 'atendente' and u.password_hash is not null
    group by u.id order by open asc, random() limit 1`);
  return (rows.rows[0] as { id: string } | undefined)?.id ?? null;
}

export async function findOpenDeal(contactId: string, tx: Tx | typeof db = db) {
  const closedIds = tx.select({ id: stages.id }).from(stages).where(inArray(stages.kind, [...CLOSED_KINDS]));
  const [d] = await tx.select().from(deals)
    .where(and(eq(deals.contactId, contactId), notInArray(deals.stageId, closedIds)))
    .orderBy(desc(deals.createdAt)).limit(1);
  return d ?? null;
}

async function upsertContact(tx: Tx, phone: string, name?: string | null) {
  const [c] = await tx.insert(contacts).values({ phoneE164: phone, name: name?.trim() || null })
    .onConflictDoUpdate({ target: contacts.phoneE164, set: { name: sql`coalesce(${contacts.name}, excluded.name)` } })
    .returning();
  return c;
}

export type InboundInput = {
  channelId: string | null;
  externalId: string | null;
  phoneRaw: string;
  pushName?: string | null;
  kind?: string;
  body?: string | null;
  mediaUrl?: string | null;
  at?: Date;
  hasAdReferral?: boolean;
};

export type InboundResult = { skipped: "telefone_invalido" } | { duplicate: true; dealId: string } | { dealId: string; created: boolean; messageId: string };

/** Mensagem recebida do cliente: cria contato/lead se precisar, registra e põe o card "esperando resposta". */
export async function recordInbound(input: InboundInput): Promise<InboundResult> {
  const phone = normalizePhone(input.phoneRaw);
  if (!phone) return { skipped: "telefone_invalido" };
  const at = input.at ?? new Date();
  const result = await db.transaction(async (tx) => {
    const contact = await upsertContact(tx, phone, input.pushName);
    let deal = await findOpenDeal(contact.id, tx);
    let created = false;
    if (!deal) {
      const lead = await stageByKey("lead", tx);
      const origin = detectOrigin({ body: input.body, hasAdReferral: input.hasAdReferral, isClient: contact.isClient });
      [deal] = await tx.insert(deals).values({
        contactId: contact.id, stageId: lead.id, ownerId: await pickOwner(tx), channelId: input.channelId, origin, stageEnteredAt: at, createdAt: at,
      }).returning();
      created = true;
      await logEvent(tx, deal.id, "lead_criado", { origin });
    }
    const [msg] = await tx.insert(messages).values({
      dealId: deal.id, contactId: contact.id, channelId: input.channelId, externalId: input.externalId,
      direction: "in", kind: input.kind ?? "text", body: input.body ?? null, mediaUrl: input.mediaUrl ?? null, status: "received", createdAt: at,
    }).onConflictDoNothing().returning({ id: messages.id });
    if (!msg) return { duplicate: true as const, dealId: deal.id };

    // Mensagem antiga reprocessada depois da resposta da Casa não reabre a espera.
    const atIso = at.toISOString();
    await tx.update(deals).set({
      lastInboundAt: sql`greatest(${deals.lastInboundAt}, ${atIso}::timestamptz)`,
      awaitingReplySince: sql`case when ${atIso}::timestamptz > coalesce(${deals.lastOutboundAt}, '-infinity'::timestamptz)
        then coalesce(${deals.awaitingReplySince}, ${atIso}::timestamptz) else ${deals.awaitingReplySince} end`,
      channelId: deal.channelId ?? input.channelId,
    }).where(eq(deals.id, deal.id));
    await logEvent(tx, deal.id, "mensagem_recebida", { messageId: msg.id });

    // Cliente respondeu durante o follow-up: volta para Atendimento.
    const [stage] = await tx.select().from(stages).where(eq(stages.id, deal.stageId));
    if (stage?.kind === "followup") await moveDealTx(tx, deal.id, "atendimento", null, "cliente_respondeu", at);
    return { dealId: deal.id, created, messageId: msg.id };
  });
  if ("dealId" in result && !("duplicate" in result)) await emit(result.created ? "lead_criado" : "mensagem_recebida", { dealId: result.dealId });
  return result;
}

export type OutboundInput = {
  contactId?: string;
  dealId?: string;
  phoneRaw?: string;
  channelId: string | null;
  externalId?: string | null;
  body?: string | null;
  kind?: string;
  userId?: string | null;
  fromPhone?: boolean;
  status?: string;
  at?: Date;
  /** Mensagem já gravada como "pending" pelo envio do CRM: atualiza em vez de inserir. */
  claimMessageId?: string;
  /** Enviada por automação (lembrete): não conta como resposta nem move etapa. */
  automated?: boolean;
};

/** Mensagem enviada pela Casa (pelo CRM ou pelo celular): conta como resposta e move Lead → Atendimento. */
export async function recordOutbound(input: OutboundInput) {
  const at = input.at ?? new Date();
  const result = await db.transaction(async (tx) => {
    let dealId = input.dealId ?? null;
    let contactId = input.contactId ?? null;
    if (!contactId && input.phoneRaw) {
      const phone = normalizePhone(input.phoneRaw);
      if (!phone) return { skipped: "telefone_invalido" as const };
      // Conversa que a Casa iniciou pelo celular também é lead: número conectado = todas as conversas no CRM.
      const c = input.fromPhone ? await upsertContact(tx, phone, null)
        : (await tx.select().from(contacts).where(eq(contacts.phoneE164, phone)))[0];
      if (!c) return { skipped: "sem_contato" as const };
      contactId = c.id;
    }
    if (!dealId && contactId) dealId = (await findOpenDeal(contactId, tx))?.id ?? null;
    if (!dealId && contactId && input.fromPhone) {
      const [c] = await tx.select().from(contacts).where(eq(contacts.id, contactId));
      const lead = await stageByKey("lead", tx);
      const origin = detectOrigin({ isClient: c?.isClient });
      const [created] = await tx.insert(deals).values({
        contactId, stageId: lead.id, ownerId: await pickOwner(tx), channelId: input.channelId, origin, stageEnteredAt: at, createdAt: at,
      }).returning();
      await logEvent(tx, created.id, "lead_criado", { origin, iniciadoPelaCasa: true });
      dealId = created.id;
    }
    if (!dealId) return { skipped: "sem_lead_aberto" as const };
    const [deal] = await tx.select().from(deals).where(eq(deals.id, dealId));
    if (!deal) return { skipped: "sem_lead_aberto" as const };

    const [msg] = input.claimMessageId
      ? await tx.update(messages).set({ status: sql`case when ${messages.status} in ('pending','sent') then ${input.status ?? "sent"} else ${messages.status} end`,
          externalId: sql`coalesce(${messages.externalId}, ${input.externalId ?? null})`, channelId: input.channelId ?? deal.channelId })
          .where(eq(messages.id, input.claimMessageId)).returning({ id: messages.id })
      : await tx.insert(messages).values({
          dealId, contactId: deal.contactId, channelId: input.channelId ?? deal.channelId, externalId: input.externalId ?? null,
          direction: "out", kind: input.kind ?? "text", body: input.body ?? null, status: input.status ?? "sent",
          sentByUserId: input.userId ?? null, fromPhone: !!input.fromPhone, createdAt: at,
        }).onConflictDoNothing().returning({ id: messages.id });
    if (!msg) return { duplicate: true as const, dealId };

    if (input.automated) {
      await tx.update(deals).set({ lastOutboundAt: at }).where(eq(deals.id, dealId));
      await logEvent(tx, dealId, "mensagem_enviada", { messageId: msg.id, automatica: true }, null);
      return { dealId, messageId: msg.id };
    }
    const responder = input.userId ?? deal.ownerId ?? null;
    if (deal.awaitingReplySince) {
      const waited = Math.max(0, Math.round((at.getTime() - deal.awaitingReplySince.getTime()) / 1000));
      await logEvent(tx, dealId, "resposta", { waitedSeconds: waited, first: !deal.firstResponseAt, fromPhone: !!input.fromPhone }, responder);
    }
    await tx.update(deals).set({
      lastOutboundAt: at, awaitingReplySince: null,
      firstResponseAt: deal.firstResponseAt ?? (deal.awaitingReplySince ? at : null),
      ownerId: deal.ownerId ?? input.userId ?? null,
    }).where(eq(deals.id, dealId));
    await logEvent(tx, dealId, "mensagem_enviada", { messageId: msg.id, fromPhone: !!input.fromPhone }, input.userId ?? null);
    // Respondeu: os alertas de espera deste lead se resolvem sozinhos.
    await tx.update(alerts).set({ resolvedAt: at, readAt: sql`coalesce(${alerts.readAt}, ${at.toISOString()}::timestamptz)` })
      .where(and(eq(alerts.dealId, dealId), eq(alerts.type, "sem_resposta_minutos"), sql`${alerts.resolvedAt} is null`));

    const [stage] = await tx.select().from(stages).where(eq(stages.id, deal.stageId));
    if (stage?.kind === "lead") await moveDealTx(tx, dealId, "atendimento", input.userId ?? null, "respondido", at);
    return { dealId, messageId: msg.id };
  });
  if ("messageId" in result) await emit("mensagem_enviada", { dealId: result.dealId });
  return result;
}

export async function moveDealTx(tx: Tx, dealId: string, stageKey: string, userId: string | null, reason: string, at = new Date()) {
  const [deal] = await tx.select().from(deals).where(eq(deals.id, dealId));
  if (!deal) throw new Error("Lead não encontrado");
  const to = await stageByKey(stageKey, tx);
  if (deal.stageId === to.id) return deal;
  const [from] = await tx.select().from(stages).where(eq(stages.id, deal.stageId));
  const closing = to.kind === "fechado" || to.kind === "perdido";
  if (deal.closedAt && !closing) {
    // Reabrir: só se o contato não tiver outro lead aberto (nunca dois abertos ao mesmo tempo).
    const other = await findOpenDeal(deal.contactId, tx);
    if (other && other.id !== deal.id) throw new ReopenConflict(other.id);
  }
  const [updated] = await tx.update(deals).set({
    stageId: to.id, stageEnteredAt: at, closedAt: closing ? at : null,
    awaitingReplySince: closing ? null : deal.awaitingReplySince,
  }).where(eq(deals.id, dealId)).returning();
  await logEvent(tx, dealId, "etapa_alterada", { de: from?.key, para: to.key, motivo: reason }, userId);
  return updated;
}

export async function moveDeal(dealId: string, stageKey: string, userId: string | null, reason = "manual") {
  const d = await db.transaction((tx) => moveDealTx(tx, dealId, stageKey, userId, reason));
  await emit("etapa_alterada", { dealId });
  return d;
}

export async function activeUsers() {
  return db.select({ id: users.id, name: users.name, role: users.role }).from(users)
    .where(and(eq(users.active, true), sql`${users.passwordHash} is not null`)).orderBy(asc(users.name));
}

export type HistoryMessage = { externalId: string; fromMe: boolean; at: Date; kind: string; body: string | null; pushName?: string | null };

/** Conversas paradas há mais que isso entram como contato com histórico, sem lead aberto. */
export const HISTORY_LEAD_DAYS = 30;
/** Só conta como "esperando resposta" se a cliente escreveu por último há menos que isso. */
const HISTORY_WAITING_HOURS = 12;

/**
 * Histórico que o WhatsApp manda ao conectar o número: uma conversa por chamada, tudo numa transação.
 * Conversa recente vira lead (Lead se a Casa nunca respondeu, Atendimento se já respondeu); antiga vira só contato com histórico.
 * Idempotente: mensagens repetidas são ignoradas pelo id externo.
 */
export async function importHistoryChat(channelId: string | null, phoneRaw: string, items: HistoryMessage[], now = new Date()) {
  const phone = normalizePhone(phoneRaw);
  if (!phone || items.length === 0) return { skipped: true as const };
  const msgs = [...items].sort((a, b) => a.at.getTime() - b.at.getTime());
  const inbound = msgs.filter((m) => !m.fromMe), outbound = msgs.filter((m) => m.fromMe);
  const name = [...inbound].reverse().find((m) => m.pushName && !/^\d+$/.test(m.pushName))?.pushName ?? null;
  const lastAt = msgs[msgs.length - 1].at;
  const lastIn = inbound.at(-1)?.at ?? null, lastOut = outbound.at(-1)?.at ?? null;

  return db.transaction(async (tx) => {
    const contact = await upsertContact(tx, phone, name);
    let deal = await findOpenDeal(contact.id, tx);
    let created = false;
    if (!deal && now.getTime() - lastAt.getTime() <= HISTORY_LEAD_DAYS * 86_400_000) {
      const stage = await stageByKey(lastOut ? "atendimento" : "lead", tx);
      const clientWaiting = lastIn && (!lastOut || lastIn > lastOut) && now.getTime() - lastIn.getTime() <= HISTORY_WAITING_HOURS * 3_600_000;
      const waitingSince = clientWaiting ? inbound.find((m) => !lastOut || m.at > lastOut)!.at : null;
      const origin = detectOrigin({ body: inbound[0]?.body, isClient: contact.isClient });
      [deal] = await tx.insert(deals).values({
        contactId: contact.id, stageId: stage.id, ownerId: await pickOwner(tx), channelId, origin,
        stageEnteredAt: now, createdAt: msgs[0].at, lastInboundAt: lastIn, lastOutboundAt: lastOut, awaitingReplySince: waitingSince,
      }).returning();
      await logEvent(tx, deal.id, "lead_criado", { origin, historico: true });
      created = true;
    }
    const rows = msgs.map((m) => ({
      dealId: deal?.id ?? null, contactId: contact.id, channelId, externalId: m.externalId, direction: m.fromMe ? "out" as const : "in" as const,
      kind: m.kind, body: m.body, status: m.fromMe ? "sent" : "received", fromPhone: m.fromMe, createdAt: m.at,
    }));
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      inserted += (await tx.insert(messages).values(rows.slice(i, i + 500)).onConflictDoNothing().returning({ id: messages.id })).length;
    }
    if (deal && !created && inserted > 0) {
      await tx.update(deals).set({
        lastInboundAt: lastIn ? sql`greatest(${deals.lastInboundAt}, ${lastIn.toISOString()}::timestamptz)` : deals.lastInboundAt,
        lastOutboundAt: lastOut ? sql`greatest(${deals.lastOutboundAt}, ${lastOut.toISOString()}::timestamptz)` : deals.lastOutboundAt,
        channelId: deal.channelId ?? channelId,
      }).where(eq(deals.id, deal.id));
    }
    return { dealId: deal?.id ?? null, created, inserted };
  });
}
