import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db, type Tx } from "../db";
import { contacts, deals, messages, stages, users, type Stage } from "../db/schema";
import { normalizePhone } from "./phone";
import { emit, logEvent } from "./events";

export const CLOSED_KINDS = ["fechado", "perdido"] as const;

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

    await tx.update(deals).set({
      lastInboundAt: at,
      awaitingReplySince: sql`coalesce(${deals.awaitingReplySince}, ${at.toISOString()}::timestamptz)`,
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
      const [c] = await tx.select().from(contacts).where(eq(contacts.phoneE164, phone));
      if (!c) return { skipped: "sem_contato" as const }; // conversa que a Casa iniciou com alguém fora do CRM: ignorada
      contactId = c.id;
    }
    if (!dealId && contactId) dealId = (await findOpenDeal(contactId, tx))?.id ?? null;
    if (!dealId) return { skipped: "sem_lead_aberto" as const };
    const [deal] = await tx.select().from(deals).where(eq(deals.id, dealId));
    if (!deal) return { skipped: "sem_lead_aberto" as const };

    const [msg] = await tx.insert(messages).values({
      dealId, contactId: deal.contactId, channelId: input.channelId ?? deal.channelId, externalId: input.externalId ?? null,
      direction: "out", kind: input.kind ?? "text", body: input.body ?? null, status: input.status ?? "sent",
      sentByUserId: input.userId ?? null, fromPhone: !!input.fromPhone, createdAt: at,
    }).onConflictDoNothing().returning({ id: messages.id });
    if (!msg) return { duplicate: true as const, dealId };

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
