import { and, asc, desc, eq, inArray, isNotNull, isNull, notInArray, notLike, or, sql } from "drizzle-orm";
import { db, type Tx } from "../db";
import { alerts, auditLog, contacts, deals, messages, stages, users, type Stage } from "../db/schema";
import { normalizePhone } from "./phone";
import { matchSource } from "./sources";
import { emit, logEvent } from "./events";
import { archiveDeals, restoreDeals } from "./archive";
import { isQuiet } from "./quiet";
import { getBusinessHours } from "./hours";
import { closesConversation } from "./message-kinds";
import { businessSecondsBetween } from "../../lib/business-hours";

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

/** Origem do lead (como a cliente conheceu a Casa) só quando há evidência. Canal (WhatsApp) não é origem: devolve null. */
export function detectSource(input: { body?: string | null; hasAdReferral?: boolean }): string | null {
  if (input.hasAdReferral) return "Anúncio";
  if (input.body && /vim\s+(pelo|do|no)\s+insta(gram)?/i.test(input.body)) return "Instagram";
  if (input.body && /vim\s+(pelo|do)\s+site/i.test(input.body)) return "Site";
  if (input.body && /(indica[cç][aã]o|me\s+indicou|indicad[ao])/i.test(input.body)) return "Indicação";
  return null;
}

/** Campo `origin` legado (telas antigas, até a T13): a origem detectada ou, sem evidência, o canal. */
export function detectOrigin(input: { body?: string | null; hasAdReferral?: boolean; isClient?: boolean }): string {
  return detectSource(input) ?? (input.isClient ? "Já é cliente" : "WhatsApp");
}

/** Distribui o lead para quem atende com menos leads abertos (rodízio por carga). Sem atendente ativa, fica com a gestão. */
async function pickOwner(tx: Tx): Promise<string | null> {
  const rows = await tx.execute(sql`
    select u.id, count(d.id)::int as open
    from users u
    left join deals d on d.owner_id = u.id and d.closed_at is null and d.archived_at is null
    where u.active and u.password_hash is not null
      and (u.role = 'atendente' or not exists (select 1 from users a where a.active and a.role = 'atendente' and a.password_hash is not null))
    group by u.id order by open asc, random() limit 1`);
  return (rows.rows[0] as { id: string } | undefined)?.id ?? null;
}

/** Lead em andamento do contato. Arquivado ("não é cliente") não conta como aberto. */
export async function findOpenDeal(contactId: string, tx: Tx | typeof db = db) {
  const closedIds = tx.select({ id: stages.id }).from(stages).where(inArray(stages.kind, [...CLOSED_KINDS]));
  const [d] = await tx.select().from(deals)
    .where(and(eq(deals.contactId, contactId), notInArray(deals.stageId, closedIds), isNull(deals.archivedAt)))
    .orderBy(desc(deals.createdAt)).limit(1);
  return d ?? null;
}

/** Lead arquivado mais recente do contato: mensagens de contato ignorado ficam nele, para o Desfazer trazer a conversa. */
export async function latestArchivedDealId(contactId: string, tx: Tx | typeof db = db): Promise<string | null> {
  const [d] = await tx.select({ id: deals.id }).from(deals)
    .where(and(eq(deals.contactId, contactId), isNotNull(deals.archivedAt)))
    .orderBy(desc(deals.archivedAt)).limit(1);
  return d?.id ?? null;
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
  media?: MediaNode | null;
  quotedBody?: string | null;
  at?: Date;
  hasAdReferral?: boolean;
  /** Relógio da resposta fora do horário (só testes); em produção é o horário real. */
  now?: Date;
};

/** Nó de mídia do WhatsApp, guardado para baixar o arquivo depois. */
export type MediaNode = { key: Record<string, unknown>; message: Record<string, unknown> };


export type InboundResult = { skipped: "telefone_invalido" } | { ignored: true } | { duplicate: true; dealId: string } | { dealId: string; created: boolean; messageId: string };

/** Mensagem recebida do cliente: cria contato/lead se precisar, registra e põe o card "esperando resposta". */
export async function recordInbound(input: InboundInput): Promise<InboundResult> {
  const phone = normalizePhone(input.phoneRaw);
  if (!phone) return { skipped: "telefone_invalido" };
  const at = input.at ?? new Date();
  const result = await db.transaction(async (tx) => {
    const contact = await upsertContact(tx, phone, input.pushName);
    // Contato marcado como "não é cliente": guarda a mensagem no lead arquivado, sem abrir lead nem alerta.
    // Se a gestão abriu um lead novo para ele na mão, segue o fluxo normal.
    if (contact.ignored && !(await findOpenDeal(contact.id, tx))) {
      await tx.insert(messages).values({ dealId: await latestArchivedDealId(contact.id, tx), contactId: contact.id, channelId: input.channelId, externalId: input.externalId, direction: "in",
        kind: input.kind ?? "text", body: input.body ?? null, media: input.media ?? null, quotedBody: input.quotedBody ?? null, status: "received", createdAt: at }).onConflictDoNothing();
      return { ignored: true as const };
    }
    let deal = await findOpenDeal(contact.id, tx);
    let created = false;
    if (!deal) {
      const lead = await stageByKey("lead", tx);
      // Link/QR de origem tem prioridade; sem ele, vale a detecção por evidência no texto/anúncio.
      const linked = await matchSource(input.body, tx);
      const origin = linked?.label ?? detectOrigin({ body: input.body, hasAdReferral: input.hasAdReferral, isClient: contact.isClient });
      [deal] = await tx.insert(deals).values({
        contactId: contact.id, stageId: lead.id, ownerId: await pickOwner(tx), channelId: input.channelId, origin,
        sourceId: linked?.id ?? null, sourceLabel: linked?.label ?? detectSource({ body: input.body, hasAdReferral: input.hasAdReferral }), stageEnteredAt: at, createdAt: at,
      }).returning();
      created = true;
      await logEvent(tx, deal.id, "lead_criado", { origin, initialStage: lead.key, historico: false });
    }
    const [msg] = await tx.insert(messages).values({
      dealId: deal.id, contactId: contact.id, channelId: input.channelId, externalId: input.externalId,
      direction: "in", kind: input.kind ?? "text", body: input.body ?? null, mediaUrl: input.mediaUrl ?? null, media: input.media ?? null, quotedBody: input.quotedBody ?? null, status: "received", createdAt: at,
    }).onConflictDoNothing().returning({ id: messages.id });
    if (!msg) return { duplicate: true as const, dealId: deal.id };

    // Mensagem antiga reprocessada depois da resposta da Casa não reabre a espera.
    const atIso = at.toISOString();
    await tx.update(deals).set({
      lastInboundAt: sql`greatest(${deals.lastInboundAt}, ${atIso}::timestamptz)`,
      // Figurinha/reação logo depois da resposta da Casa ("obrigada" em figurinha) não cobra resposta.
      awaitingReplySince: closesConversation(input.kind) && !created && deal.lastOutboundAt ? deals.awaitingReplySince
        : sql`case when ${atIso}::timestamptz > coalesce(${deals.lastOutboundAt}, '-infinity'::timestamptz)
        then coalesce(${deals.awaitingReplySince}, ${atIso}::timestamptz) else ${deals.awaitingReplySince} end`,
      channelId: deal.channelId ?? input.channelId,
    }).where(eq(deals.id, deal.id));
    await logEvent(tx, deal.id, "mensagem_recebida", { messageId: msg.id });

    // Cliente respondeu durante o follow-up: volta para Atendimento.
    const [stage] = await tx.select().from(stages).where(eq(stages.id, deal.stageId));
    if (stage?.kind === "followup") await moveDealTx(tx, deal.id, "atendimento", null, "cliente_respondeu", at);
    return { dealId: deal.id, created, messageId: msg.id };
  });
  if ("dealId" in result && "created" in result) {
    await emit(result.created ? "lead_criado" : "mensagem_recebida", { dealId: result.dealId });
    // Resposta fora do horário: depois do commit e sem nunca derrubar a ingestão da mensagem.
    try { if (result.dealId) { const { maybeAutoReply } = await import("./auto-reply"); await maybeAutoReply(result.dealId, at, input.now); } }
    catch (e) { console.error("[auto-resposta] não enfileirou", result.dealId, e instanceof Error ? e.message : e); }
  }
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
  media?: MediaNode | null;
  quotedBody?: string | null;
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
      if (c.ignored && !(await findOpenDeal(c.id, tx))) {
        await tx.insert(messages).values({ dealId: await latestArchivedDealId(c.id, tx), contactId: c.id, channelId: input.channelId, externalId: input.externalId ?? null, direction: "out",
          kind: input.kind ?? "text", body: input.body ?? null, status: input.status ?? "sent", fromPhone: !!input.fromPhone, media: input.media ?? null, createdAt: at }).onConflictDoNothing();
        return { skipped: "contato_ignorado" as const };
      }
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
      await logEvent(tx, created.id, "lead_criado", { origin, initialStage: lead.key, historico: false, iniciadoPelaCasa: true });
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
          sentByUserId: input.userId ?? null, fromPhone: !!input.fromPhone, media: input.media ?? null, quotedBody: input.quotedBody ?? null, createdAt: at,
        }).onConflictDoNothing().returning({ id: messages.id });
    if (!msg) return { duplicate: true as const, dealId };

    // Mensagem da Casa mais antiga que a espera atual (chegou atrasada no webhook): só entra na conversa.
    // A cliente escreveu depois dela, então continua esperando resposta.
    const stale = !!deal.awaitingReplySince && at < deal.awaitingReplySince;
    if (input.automated || stale) {
      await tx.update(deals).set({ lastOutboundAt: sql`greatest(${deals.lastOutboundAt}, ${at.toISOString()}::timestamptz)` }).where(eq(deals.id, dealId));
      await logEvent(tx, dealId, "mensagem_enviada", { messageId: msg.id, ...(input.automated ? { automatica: true } : { atrasada: true }) }, null);
      return { dealId, messageId: msg.id };
    }
    // Resposta pelo celular não tem login: vale para quem está com o lead (quem assumiu).
    const responder = input.fromPhone ? (deal.ownerId ?? input.userId ?? null) : (input.userId ?? deal.ownerId ?? null);
    const [stage] = await tx.select().from(stages).where(eq(stages.id, deal.stageId));
    if (deal.awaitingReplySince) {
      // Tempo de resposta conta só o expediente: mensagem das 23h respondida às 8h não é "9 horas de atraso".
      const waited = businessSecondsBetween(deal.awaitingReplySince.getTime(), at.getTime(), await getBusinessHours(tx));
      await logEvent(tx, dealId, "resposta", {
        waitedSeconds: waited, first: !deal.firstResponseAt, fromPhone: !!input.fromPhone,
        stage: stage?.key ?? null, slaSeconds: stage?.slaMinutes ? stage.slaMinutes * 60 : null,
      }, responder);
    }
    await tx.update(deals).set({
      lastOutboundAt: at, awaitingReplySince: null,
      firstResponseAt: deal.firstResponseAt ?? (deal.awaitingReplySince ? at : null),
      ownerId: deal.ownerId ?? input.userId ?? null,
    }).where(eq(deals.id, dealId));
    await logEvent(tx, dealId, "mensagem_enviada", { messageId: msg.id, fromPhone: !!input.fromPhone }, input.userId ?? null);
    // Respondeu: os alertas de espera deste lead se resolvem sozinhos.
    const resolvedNow = new Date(); // hora real da resolução (a mensagem pode ter chegado atrasada)
    await tx.update(alerts).set({ resolvedAt: resolvedNow, readAt: sql`coalesce(${alerts.readAt}, ${resolvedNow.toISOString()}::timestamptz)` })
      .where(and(sql`${alerts.resolvedAt} is null`, or(
        // alertas de espera deste lead (wait_key = "<dealId>:<desde>") e, por compatibilidade, os anteriores à chave
        // (lembretes de tarefa, wait_key "task:<id>", não são espera: só se resolvem ao concluir a tarefa — mesma regra de `lateWhere`)
        and(eq(alerts.dealId, dealId), isNotNull(alerts.waitKey), notLike(alerts.waitKey, "task:%")),
        and(eq(alerts.dealId, dealId), eq(alerts.type, "sem_resposta_minutos"), isNull(alerts.waitKey)),
      )));

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
  if (closing) {
    // Lead fechado ou perdido não espera mais resposta: os alertas abertos se resolvem.
    await tx.update(alerts).set({ resolvedAt: at, readAt: sql`coalesce(${alerts.readAt}, ${at.toISOString()}::timestamptz)` })
      .where(and(eq(alerts.dealId, dealId), isNull(alerts.resolvedAt)));
  }
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

export type HistoryMessage = { externalId: string; fromMe: boolean; at: Date; kind: string; body: string | null; pushName?: string | null; media?: MediaNode | null; quotedBody?: string | null };

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

  // Canal em modo quieto (acabou de parear): conversa do histórico não abre espera (nem aviso quando o modo acabar).
  const quiet = await isQuiet(channelId, now);
  return db.transaction(async (tx) => {
    const contact = await upsertContact(tx, phone, name);
    let deal = await findOpenDeal(contact.id, tx);
    let created = false;
    if (!deal && !contact.ignored && now.getTime() - lastAt.getTime() <= HISTORY_LEAD_DAYS * 86_400_000) {
      const stage = await stageByKey(lastOut ? "atendimento" : "lead", tx);
      const clientWaiting = !quiet && lastIn && (!lastOut || lastIn > lastOut) && now.getTime() - lastIn.getTime() <= HISTORY_WAITING_HOURS * 3_600_000;
      const waitingSince = clientWaiting ? inbound.find((m) => !lastOut || m.at > lastOut)!.at : null;
      const origin = detectOrigin({ body: inbound[0]?.body, isClient: contact.isClient });
      [deal] = await tx.insert(deals).values({
        contactId: contact.id, stageId: stage.id, ownerId: await pickOwner(tx), channelId, origin, sourceLabel: detectSource({ body: inbound[0]?.body }),
        stageEnteredAt: now, createdAt: msgs[0].at, lastInboundAt: lastIn, lastOutboundAt: lastOut, awaitingReplySince: waitingSince,
      }).returning();
      await logEvent(tx, deal.id, "lead_criado", { origin, initialStage: stage.key, historico: true });
      created = true;
    }
    const dealId = deal?.id ?? (contact.ignored ? await latestArchivedDealId(contact.id, tx) : null);
    const rows = msgs.map((m) => ({
      dealId, contactId: contact.id, channelId, externalId: m.externalId, direction: m.fromMe ? "out" as const : "in" as const,
      kind: m.kind, body: m.body, media: m.media ?? null, quotedBody: m.quotedBody ?? null, status: m.fromMe ? "sent" : "received", fromPhone: m.fromMe, createdAt: m.at,
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

/**
 * "Não é cliente": tira a conversa do funil (conversa pessoal, fornecedor, engano) sem apagar nada.
 * O lead fica arquivado com as mensagens; mensagens novas entram nele sem abrir lead nem alerta até "Desfazer".
 */
export async function ignoreContact(dealId: string, userId: string) {
  const [d] = await db.select({ contactId: deals.contactId }).from(deals).where(eq(deals.id, dealId));
  if (!d) throw new Error("Lead não encontrado");
  await archiveDeals([dealId], userId);
  return { contactId: d.contactId };
}

/** Voltar a acompanhar: restaura o lead arquivado mais recente do contato (ou só tira a marca, se não houver). */
export async function unignoreContact(contactId: string, userId: string) {
  const dealId = await latestArchivedDealId(contactId);
  if (dealId) {
    const r = await restoreDeals([dealId], userId);
    if (r.restored) return r;
  }
  await db.update(contacts).set({ ignored: false }).where(eq(contacts.id, contactId));
  await db.insert(auditLog).values({ userId, action: "voltou_a_acompanhar", entity: "contact", entityId: contactId, data: {} });
  return { restored: 0, conflicts: dealId ? [dealId] : [] };
}
