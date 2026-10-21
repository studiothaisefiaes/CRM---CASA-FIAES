import { and, asc, desc, eq, inArray, isNotNull, isNull, notInArray, notLike, or, sql } from "drizzle-orm";
import { routeNewLead } from "./distribution";
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
import { sentViaOf, signatureMap, signerOf, warnOwnerRepliedByOther } from "./authorship";
import { applyConfirmationTx } from "./confirmation";
import { parseSignature, signatureKey } from "../../lib/signature";
import { UserFacingError } from "./errors";
import { cancelAttemptTaskTx, startAttemptsTx, stopAttemptsTx, type AttemptStart } from "./attempts";
import { isAttemptKind, isWaitingKind } from "../../lib/attempts";
import { mergedTargetFor, mergedTargetForLid } from "./merge-contacts";

export const CLOSED_KINDS = ["fechado", "perdido"] as const;

/** O contato já tem outro lead aberto; reabrir este criaria duplicidade. */
export class ReopenConflict extends Error {
  constructor(public openDealId: string) { super("Esta cliente já tem outra conversa em andamento."); }
}

export async function getStages(tx: Tx | typeof db = db): Promise<Stage[]> {
  return tx.select().from(stages).where(eq(stages.active, true)).orderBy(asc(stages.position));
}

export async function stageByKey(key: string, tx: Tx | typeof db = db) {
  const [s] = await tx.select().from(stages).where(eq(stages.key, key)).limit(1);
  if (!s) throw new Error(`Etapa "${key}" não existe`);
  return s;
}

export type StageKind = Stage["kind"];

/** A etapa ativa de um TIPO (a primeira pela ordem). O código decide pelo tipo; a chave é só o nome técnico (decisão do Lote 1C). */
export async function stageByKind(kind: StageKind, tx: Tx | typeof db = db): Promise<Stage> {
  const [s] = await tx.select().from(stages).where(and(eq(stages.kind, kind), eq(stages.active, true))).orderBy(asc(stages.position)).limit(1);
  if (!s) throw new Error(`Nenhuma etapa ativa do tipo "${kind}"`);
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

/** Distribui o lead para quem tem "Receber leads da distribuição" com menos leads abertos (rodízio por carga). Sem ninguém assim, entre todos os ativos. */
/**
 * Distribuição desligada: quem recebe a conversa nova é quem tem "Receber leads da distribuição" e menos leads abertos.
 * Ninguém com essa permissão (só a gestão ativa): fica Sem dono. A gestão nunca recebe conversa sozinha (pedido da Casa, 14/10).
 */
async function pickOwner(tx: Tx): Promise<string | null> {
  const rows = await tx.execute(sql`
    select u.id, count(d.id)::int as open
    from users u
    join profiles p on p.id = u.profile_id
    left join deals d on d.owner_id = u.id and d.closed_at is null and d.archived_at is null
    where u.active and u.password_hash is not null and p.permissions @> array['distribuicao.receber']::text[]
    group by u.id order by open asc, random() limit 1`);
  return (rows.rows[0] as { id: string } | undefined)?.id ?? null;
}

/** Lead em andamento do contato. Arquivado ("não é cliente") não conta como aberto. */
export async function findOpenDeal(contactId: string, tx: Tx | typeof db = db) {
  const closedIds = tx.select({ id: stages.id }).from(stages).where(inArray(stages.kind, [...CLOSED_KINDS]));
  const [d] = await tx.select().from(deals)
    // Atendida que terminou (nova organização, 16/10) tem `closedAt` sem estar numa etapa de fechamento: também não está aberta.
    .where(and(eq(deals.contactId, contactId), notInArray(deals.stageId, closedIds), isNull(deals.archivedAt), isNull(deals.closedAt)))
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

/**
 * Contato da conversa pelo número e/ou pelo identificador anônimo do WhatsApp (@lid, só dígitos).
 * - Só @lid: o contato nasce com phoneE164 = "lid:<dígitos>" (número oculto) e é achado pelo @lid nas próximas mensagens.
 * - Número + @lid: o contato do número aprende o @lid; se só existia o oculto, ele ganha o número de verdade (sem duplicar).
 * Dois contatos diferentes (um pelo número, outro oculto) ficam como estão: juntar é o "Unir cadastros" (`merge-contacts.ts`).
 * - Número ou @lid de uma cliente que saiu num "Unir cadastros" (sem contato vivo com ele): a que ficou (`contact_merges`).
 */
export async function resolveContact(tx: Tx, phone: string | null, lid: string | null, name?: string | null) {
  if (!lid) {
    if (!phone) return null;
    // Telefone de uma cliente que saiu num "Unir cadastros" (0086): cai na que ficou, não recria a que saiu.
    const [live] = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.phoneE164, phone));
    const merged = live ? null : await mergedContact(tx, await mergedTargetFor(tx, phone));
    return merged ?? upsertContact(tx, phone, name);
  }
  const [byLid] = await tx.select().from(contacts).where(eq(contacts.waLid, lid));
  if (!phone) {
    if (byLid) return name?.trim() && !byLid.name ? (await tx.update(contacts).set({ name: name.trim() }).where(eq(contacts.id, byLid.id)).returning())[0] : byLid;
    const merged = await mergedContact(tx, await mergedTargetForLid(tx, lid));
    if (merged) return merged;
    return (await tx.insert(contacts).values({ phoneE164: `lid:${lid}`, waLid: lid, name: name?.trim() || null })
      .onConflictDoUpdate({ target: contacts.phoneE164, set: { name: sql`coalesce(${contacts.name}, excluded.name)` } }).returning())[0];
  }
  const [byPhone] = await tx.select().from(contacts).where(eq(contacts.phoneE164, phone));
  if (byPhone) {
    if (!byPhone.waLid && !byLid) await tx.update(contacts).set({ waLid: lid }).where(eq(contacts.id, byPhone.id));
    return byPhone;
  }
  const merged = await mergedContact(tx, await mergedTargetFor(tx, phone));
  if (merged) {
    if (!merged.waLid && !byLid) await tx.update(contacts).set({ waLid: lid }).where(eq(contacts.id, merged.id));
    return merged;
  }
  if (byLid?.phoneE164.startsWith("lid:")) {
    return (await tx.update(contacts).set({ phoneE164: phone, name: sql`coalesce(${contacts.name}, ${name?.trim() || null})` }).where(eq(contacts.id, byLid.id)).returning())[0];
  }
  return (await tx.insert(contacts).values({ phoneE164: phone, waLid: byLid ? null : lid, name: name?.trim() || null }).returning())[0];
}

async function mergedContact(tx: Tx, keptId: string | null) {
  if (!keptId) return null;
  const [c] = await tx.select().from(contacts).where(eq(contacts.id, keptId));
  return c ?? null;
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
  /** Identificador anônimo do WhatsApp (@lid, só dígitos), quando a conversa vem sem número visível. */
  lid?: string | null;
  pushName?: string | null;
  kind?: string;
  body?: string | null;
  mediaUrl?: string | null;
  media?: MediaNode | null;
  quotedBody?: string | null;
  at?: Date;
  hasAdReferral?: boolean;
  /** Registro que não cobra resposta (ligação atendida, Lote 5): não abre espera, não desarquiva, não volta etapa nem responde fora do horário. */
  noWait?: boolean;
  /** Relógio da resposta fora do horário (só testes); em produção é o horário real. */
  now?: Date;
};

/** Nó de mídia do WhatsApp, guardado para baixar o arquivo depois. */
export type MediaNode = { key: Record<string, unknown>; message: Record<string, unknown> };


export type InboundResult = { skipped: "telefone_invalido" } | { ignored: true } | { duplicate: true; dealId: string } | { dealId: string; created: boolean; messageId: string };

/** Etapas em que a bola está com a cliente: se ela escreve de verdade, a conversa volta para Em conversa (spec 1C, etapas 2, 3 e 6). */
export const BACK_TO_CONVERSATION_KINDS = ["followup", "proposta", "retorno"] as const;

/** Mensagem recebida do cliente: cria contato/lead se precisar, registra e põe o card "esperando resposta". */
export async function recordInbound(input: InboundInput): Promise<InboundResult> {
  const phone = normalizePhone(input.phoneRaw);
  const lid = input.lid?.replace(/\D/g, "") || null;
  if (!phone && !lid) return { skipped: "telefone_invalido" };
  const at = input.at ?? new Date();
  const result = await db.transaction(async (tx) => {
    const contact = (await resolveContact(tx, phone, lid, input.pushName))!;
    // Contato marcado como "não é cliente": guarda a mensagem no lead arquivado, sem abrir lead nem alerta.
    // Se a gestão abriu um lead novo para ele na mão, segue o fluxo normal.
    if (contact.ignored && !(await findOpenDeal(contact.id, tx))) {
      const keep = await latestArchivedDealId(contact.id, tx);
      const [kept] = await tx.insert(messages).values({ dealId: keep, contactId: contact.id, channelId: input.channelId, externalId: input.externalId, direction: "in",
        kind: input.kind ?? "text", body: input.body ?? null, media: input.media ?? null, quotedBody: input.quotedBody ?? null, status: "received", createdAt: at }).onConflictDoNothing().returning({ id: messages.id });
      // Fica como não lida em Filtros › Não é cliente (nunca some sem rastro); abrir a conversa marca como vista.
      if (kept && keep) await tx.update(deals).set({ lastInboundAt: sql`greatest(${deals.lastInboundAt}, ${at.toISOString()}::timestamptz)` }).where(eq(deals.id, keep));
      return { ignored: true as const };
    }
    let deal = await findOpenDeal(contact.id, tx);
    let created = false;
    if (!deal) {
      // Cliente que volta depois de Fechado/Perdido (funil da decisão 3; regra que o 1C deixou para o Lote 3): começa em Em conversa.
      const [before] = await tx.select({ id: deals.id }).from(deals)
        .where(and(eq(deals.contactId, contact.id), isNotNull(deals.closedAt), isNull(deals.archivedAt))).limit(1);
      const lead = await stageByKind(before ? "atendimento" : "lead", tx);
      // Link/QR de origem tem prioridade; sem ele, vale a detecção por evidência no texto/anúncio.
      const linked = await matchSource(input.body, tx);
      const origin = linked?.label ?? detectOrigin({ body: input.body, hasAdReferral: input.hasAdReferral, isClient: contact.isClient });
      // Distribuição ligada: quem está livre recebe (ou ninguém); desligada: a regra antiga (menos leads abertos).
      const routed = await routeNewLead(tx, contact.id);
      [deal] = await tx.insert(deals).values({
        contactId: contact.id, stageId: lead.id, ownerId: routed.handled ? routed.ownerId : await pickOwner(tx), channelId: input.channelId, origin,
        sourceId: linked?.id ?? null, sourceLabel: linked?.label ?? detectSource({ body: input.body, hasAdReferral: input.hasAdReferral }), stageEnteredAt: at, createdAt: at,
      }).returning();
      created = true;
      await logEvent(tx, deal.id, "lead_criado", { origin, initialStage: lead.key, historico: false, ...(before ? { voltou: true } : {}) });
      if (routed.handled) await logEvent(tx, deal.id, "distribuido", { para: routed.ownerId, motivo: routed.motivo });
    }
    const [msg] = await tx.insert(messages).values({
      dealId: deal.id, contactId: contact.id, channelId: input.channelId, externalId: input.externalId,
      direction: "in", kind: input.kind ?? "text", body: input.body ?? null, mediaUrl: input.mediaUrl ?? null, media: input.media ?? null, quotedBody: input.quotedBody ?? null, status: "received", createdAt: at,
    }).onConflictDoNothing().returning({ id: messages.id });
    if (!msg) return { duplicate: true as const, dealId: deal.id };

    // Mensagem antiga reprocessada depois da resposta da Casa não reabre a espera.
    const atIso = at.toISOString();
    // Figurinha/reação logo depois da resposta da Casa, ou ligação atendida: fica registrado, sem cobrar resposta.
    const keepWait = !!input.noWait || (closesConversation(input.kind ?? "text", input.body) && !created && !!deal.lastOutboundAt);
    await tx.update(deals).set({
      lastInboundAt: sql`greatest(${deals.lastInboundAt}, ${atIso}::timestamptz)`,
      // Figurinha/reação logo depois da resposta da Casa ("obrigada" em figurinha) não cobra resposta.
      awaitingReplySince: keepWait ? deals.awaitingReplySince
        : sql`case when ${atIso}::timestamptz > coalesce(${deals.lastOutboundAt}, '-infinity'::timestamptz)
        then coalesce(${deals.awaitingReplySince}, ${atIso}::timestamptz) else ${deals.awaitingReplySince} end`,
      channelId: deal.channelId ?? input.channelId,
      // Conversa arquivada: a cliente escreveu de novo, volta para a Fila (figurinha/reação logo depois da Casa não desarquiva).
      conversationArchivedAt: keepWait ? deals.conversationArchivedAt : null,
    }).where(eq(deals.id, deal.id));
    if (deal.conversationArchivedAt && !input.noWait && !(closesConversation(input.kind ?? "text", input.body) && deal.lastOutboundAt)) await logEvent(tx, deal.id, "conversa_desarquivada", { motivo: "cliente_escreveu" });
    await logEvent(tx, deal.id, "mensagem_recebida", { messageId: msg.id });

    // A cliente escreveu com a bola com ela (Aguardando, Orçamento, Retorno sugerido): volta para Em conversa.
    // "Obrigada!"/figurinha logo depois da Casa não conta: continua aguardando.
    const [stage] = await tx.select().from(stages).where(eq(stages.id, deal.stageId));
    const onlyClosing = keepWait;
    if (stage && (BACK_TO_CONVERSATION_KINDS as readonly string[]).includes(stage.kind) && !onlyClosing) await moveToKindTx(tx, deal.id, "atendimento", null, "cliente_respondeu", at);
    // Em conversa esperando a cliente (tentativas correndo): ela respondeu, as tentativas param. A etapa não muda.
    else if (stage?.kind === "atendimento" && deal.followupAttempt > 0 && !onlyClosing) {
      await stopAttemptsTx(tx, deal, null, at);
      await logEvent(tx, deal.id, "tentativas_paradas", { motivo: "cliente_respondeu", tentativa: deal.followupAttempt });
    }
    return { dealId: deal.id, created, messageId: msg.id };
  });
  // "Não é cliente" que escreveu: a Fila atualiza o número do Filtros › Não é cliente (sem som nem aviso).
  if ("ignored" in result) await emit("mensagem_recebida", {});
  if ("dealId" in result && "created" in result) {
    // Toda mensagem da cliente avisa no sino e no celular, em qualquer etapa. Depois do commit e sem nunca derrubar a ingestão.
    // ANTES do evento: a tela que recebe o evento busca o sino na hora e já acha o aviso.
    let noticed = false;
    if (!input.noWait && result.dealId && result.messageId) {
      try { const { noticeClientMessage } = await import("./client-message-alert"); noticed = await noticeClientMessage({ dealId: result.dealId, messageId: result.messageId, kind: input.kind ?? "text", body: input.body, at, now: input.now }); }
      catch (e) { console.error("[aviso de mensagem] não avisou", result.dealId, e instanceof Error ? e.message : e); }
    }
    // `aviso`: as telas tocam o som. A mesma regra do aviso no sino: mensagem de verdade da cliente, em qualquer etapa; nada para ligação atendida,
    // reação, mensagem com mais de 6 h (reprocessada) nem canal em modo quieto (histórico importando).
    await emit(result.created ? "lead_criado" : "mensagem_recebida", { dealId: result.dealId, ...(noticed ? { aviso: true } : {}) });
    // Resposta fora do horário: depois do commit e sem nunca derrubar a ingestão da mensagem.
    try { if (result.dealId && !input.noWait) { const { maybeAutoReply } = await import("./auto-reply"); await maybeAutoReply(result.dealId, at, input.now); } }
    catch (e) { console.error("[auto-resposta] não enfileirou", result.dealId, e instanceof Error ? e.message : e); }
    // Boas-vindas e ausência (Lote 4; nascem desligadas). Depois do commit e sem nunca derrubar a ingestão.
    try { if (result.dealId) { const { afterInbound } = await import("./auto-messages"); await afterInbound({ dealId: result.dealId, created: result.created === true, at, now: input.now }); } }
    catch (e) { console.error("[mensagem automática] não enfileirou", result.dealId, e instanceof Error ? e.message : e); }
    // Menu de boas-vindas (Lote 5, desligado por padrão): número novo recebe o menu; "1"/"2" logo depois vira etiqueta e nota.
    // Ligação (perdida ou atendida) não é conversa escrita: não recebe menu nem conta como escolha.
    if (result.dealId && !input.noWait && (input.kind ?? "text") !== "call") {
      try {
        const { maybeWelcomeChoice, maybeWelcomeMenu } = await import("./welcome-menu");
        if (result.created) await maybeWelcomeMenu(result.dealId, at, input.now);
        else await maybeWelcomeChoice(result.dealId, input.body, at);
      } catch (e) { console.error("[menu de boas-vindas]", result.dealId, e instanceof Error ? e.message : e); }
    }
    // Regras por acontecimento (palavra, contato novo, mídia; a ligação perdida vem do webhook). Depois do commit e sem nunca derrubar a ingestão.
    // Ligação atendida (noWait) não é acontecimento; mensagem velha (reprocessada) e importada o próprio runEventRules ignora.
    if (result.dealId && result.messageId && !input.noWait) {
      try {
        const { runEventRules } = await import("../rules/events");
        await runEventRules({ type: "mensagem", dealId: result.dealId, messageId: result.messageId, kind: input.kind ?? "text", body: input.body ?? null, created: result.created === true, at }, input.now);
      } catch (e) { console.error("[regras por acontecimento]", result.dealId, e instanceof Error ? e.message : e); }
    }
  }
  return result;
}

export type OutboundInput = {
  contactId?: string;
  dealId?: string;
  phoneRaw?: string;
  /** Conversa com número oculto (@lid, só dígitos). */
  lid?: string | null;
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
  /** Ligação (kind "call") registrada à mão: os dados dela entram junto com a linha. */
  call?: import("@/lib/calls").CallInfo | null;
};

/**
 * Mensagem enviada pela Casa (pelo CRM ou pelo celular): conta como resposta e move Lead → Atendimento.
 * Autora: no CRM, a pessoa logada; pelo celular ou ChatGuru, a assinatura "*NOME - CASA FIAES:*" (Configurações › Equipe).
 * Sem dona, quem respondeu vira a dona (também a gestão). Com dona, a dona não muda e, se foi outra pessoa, recebe um aviso.
 */
export async function recordOutbound(input: OutboundInput) {
  const at = input.at ?? new Date();
  const result = await db.transaction(async (tx) => {
    const signer = input.automated || input.userId ? null : await signerOf(tx, input.body);
    const authorId = input.automated ? null : input.userId ?? signer?.id ?? null;
    const sentVia = sentViaOf({ fromPhone: input.fromPhone, automated: input.automated, authorId });
    // Dona automática só para quem está na equipe: assinatura de pessoa desativada só registra a autora.
    const signerOwner = signer?.active ? signer.id : null;
    let dealId = input.dealId ?? null;
    let contactId = input.contactId ?? null;
    const lid = input.lid?.replace(/\D/g, "") || null;
    if (!contactId && (input.phoneRaw || lid)) {
      const phone = input.phoneRaw ? normalizePhone(input.phoneRaw) : null;
      if (!phone && !lid) return { skipped: "telefone_invalido" as const };
      // Conversa que a Casa iniciou pelo celular também é lead: número conectado = todas as conversas no CRM.
      const c = input.fromPhone ? await resolveContact(tx, phone, lid, null)
        : phone ? (await tx.select().from(contacts).where(eq(contacts.phoneE164, phone)))[0]
        : (await tx.select().from(contacts).where(eq(contacts.waLid, lid!)))[0];
      if (!c) return { skipped: "sem_contato" as const };
      if (c.ignored && !(await findOpenDeal(c.id, tx))) {
        await tx.insert(messages).values({ dealId: await latestArchivedDealId(c.id, tx), contactId: c.id, channelId: input.channelId, externalId: input.externalId ?? null, direction: "out",
          kind: input.kind ?? "text", body: input.body ?? null, status: input.status ?? "sent", fromPhone: !!input.fromPhone, sentByUserId: authorId, sentVia, media: input.media ?? null, createdAt: at }).onConflictDoNothing();
        return { skipped: "contato_ignorado" as const };
      }
      // Eco da Casa (celular, ChatGuru) para um número que o WhatsApp ainda não revelou (@lid) e que nunca escreveu: NÃO é conversa (20/10: "número
      // oculto não era para existir"). A mensagem fica guardada numa conversa arquivada, fora da Fila, do Quadro e dos contadores; quando o número
      // aparece (`mergeLidInto`) ou a pessoa escreve, ela entra na conversa certa.
      if (input.fromPhone && c.phoneE164.startsWith("lid:")) {
        const [inbound] = await tx.select({ id: messages.id }).from(messages).where(and(eq(messages.contactId, c.id), eq(messages.direction, "in"))).limit(1);
        if (!inbound) {
          let quietDeal = (await tx.select({ id: deals.id }).from(deals).where(eq(deals.contactId, c.id)).orderBy(desc(deals.createdAt)).limit(1))[0]?.id ?? null;
          if (!quietDeal) {
            const lead = await stageByKind("lead", tx);
            [{ id: quietDeal }] = await tx.insert(deals).values({ contactId: c.id, stageId: lead.id, channelId: input.channelId, origin: detectOrigin({ isClient: c.isClient }),
              stageEnteredAt: at, createdAt: at, archivedAt: at }).returning({ id: deals.id });
          }
          await tx.insert(messages).values({ dealId: quietDeal, contactId: c.id, channelId: input.channelId, externalId: input.externalId ?? null, direction: "out",
            kind: input.kind ?? "text", body: input.body ?? null, status: input.status ?? "sent", fromPhone: true, sentByUserId: authorId, sentVia, media: input.media ?? null, createdAt: at }).onConflictDoNothing();
          return { skipped: "numero_oculto_silencioso" as const };
        }
      }
      contactId = c.id;
    }
    if (!dealId && contactId) dealId = (await findOpenDeal(contactId, tx))?.id ?? null;
    if (!dealId && contactId && input.fromPhone) {
      const [c] = await tx.select().from(contacts).where(eq(contacts.id, contactId));
      const lead = await stageByKind("lead", tx);
      const origin = detectOrigin({ isClient: c?.isClient });
      const [created] = await tx.insert(deals).values({
        // Quem assinou a primeira mensagem já é a dona; sem assinatura, a regra antiga (distribuição, nunca a gestão).
        contactId, stageId: lead.id, ownerId: signerOwner ?? await pickOwner(tx), channelId: input.channelId, origin, stageEnteredAt: at, createdAt: at,
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
          sentByUserId: authorId, sentVia, fromPhone: !!input.fromPhone, media: input.media ?? null, quotedBody: input.quotedBody ?? null, createdAt: at,
          ...(input.call ? { call: input.call } : {}),
        }).onConflictDoNothing().returning({ id: messages.id });
    if (!msg) return { duplicate: true as const, dealId };

    // Mensagem da Casa mais antiga que a espera atual (chegou atrasada no webhook): só entra na conversa.
    // A cliente escreveu depois dela, então continua esperando resposta.
    const stale = !!deal.awaitingReplySince && at < deal.awaitingReplySince;
    if (input.automated || stale) {
      await tx.update(deals).set({ lastOutboundAt: sql`greatest(${deals.lastOutboundAt}, ${at.toISOString()}::timestamptz)` }).where(eq(deals.id, dealId));
      await logEvent(tx, dealId, "mensagem_enviada", { messageId: msg.id, ...(input.automated ? { automatica: true } : { atrasada: true }) }, null);
      return { dealId, messageId: msg.id, warned: false };
    }
    // Quem respondeu: pelo celular, quem assinou; sem assinatura (áudio, foto), conta para a dona.
    const responder = input.fromPhone ? (signer?.id ?? deal.ownerId ?? input.userId ?? null) : (input.userId ?? deal.ownerId ?? null);
    const [stage] = await tx.select().from(stages).where(eq(stages.id, deal.stageId));
    if (deal.awaitingReplySince) {
      // Tempo de resposta conta só o expediente: mensagem das 23h respondida às 8h não é "9 horas de atraso".
      const waited = businessSecondsBetween(deal.awaitingReplySince.getTime(), at.getTime(), await getBusinessHours(tx));
      await logEvent(tx, dealId, "resposta", {
        waitedSeconds: waited, first: !deal.firstResponseAt, fromPhone: !!input.fromPhone,
        stage: stage?.key ?? null, slaSeconds: stage?.slaMinutes ? stage.slaMinutes * 60 : null, messageId: msg.id,
      }, responder);
    }
    await tx.update(deals).set({
      lastOutboundAt: at, awaitingReplySince: null, conversationArchivedAt: null, // a Casa escreveu: a conversa arquivada volta
      firstResponseAt: deal.firstResponseAt ?? (deal.awaitingReplySince ? at : null),
      ownerId: deal.ownerId ?? input.userId ?? signerOwner ?? null,
      ...(authorId ? { lastReplyById: authorId, lastReplyVia: sentVia } : {}),
    }).where(eq(deals.id, dealId));
    if (!deal.ownerId && !input.userId && signerOwner) await logEvent(tx, dealId, "assumiu", { de: null, para: signerOwner, motivo: "assinatura" }, signerOwner);
    else if (!deal.ownerId && input.userId) await logEvent(tx, dealId, "assumiu", { de: null, para: input.userId, motivo: "resposta_crm" }, input.userId);
    let warned = false;
    if (authorId && deal.ownerId && authorId !== deal.ownerId) warned = await warnOwnerRepliedByOther(tx, { dealId, ownerId: deal.ownerId, authorId, at });
    await logEvent(tx, dealId, "mensagem_enviada", { messageId: msg.id, fromPhone: !!input.fromPhone }, authorId);
    // Respondeu: os alertas de espera deste lead se resolvem sozinhos.
    const resolvedNow = new Date(); // hora real da resolução (a mensagem pode ter chegado atrasada)
    await tx.update(alerts).set({ resolvedAt: resolvedNow, readAt: sql`coalesce(${alerts.readAt}, ${resolvedNow.toISOString()}::timestamptz)` })
      .where(and(sql`${alerts.resolvedAt} is null`, or(
        // alertas de espera deste lead (wait_key = "<dealId>:<desde>") e, por compatibilidade, os anteriores à chave
        // (lembretes de tarefa, wait_key "task:<id>", não são espera: só se resolvem ao concluir a tarefa — mesma regra de `lateWhere`)
        and(eq(alerts.dealId, dealId), isNotNull(alerts.waitKey), notLike(alerts.waitKey, "task:%")),
        and(eq(alerts.dealId, dealId), eq(alerts.type, "sem_resposta_minutos"), isNull(alerts.waitKey)),
        // o aviso "a cliente escreveu" (só o automático não conta como resposta)
        ...(input.automated ? [] : [and(eq(alerts.dealId, dealId), eq(alerts.type, "mensagem_cliente"))]),
      )));

    if (stage?.kind === "lead") await moveToKindTx(tx, dealId, "atendimento", input.userId ?? null, "respondido", at);
    // A confirmação padrão da Casa ("Confirmado agendamento … dia 17/10 … às 9h") marca Agendado sozinho e fecha o combinado de confirmar.
    await applyConfirmationTx(tx, dealId, input.body ?? null, at, authorId ?? deal.ownerId ?? null);
    return { dealId, messageId: msg.id, warned };
  });
  if ("messageId" in result) await emit("mensagem_enviada", { dealId: result.dealId });
  if ("warned" in result && result.warned) await emit("alerta", { dealId: result.dealId });
  return result;
}

/**
 * Move para a etapa da chave. Entrar em Aguardando cliente / Orçamento enviado começa as tentativas (`opts`: data e título da 1ª);
 * sair delas zera o contador e cancela a tentativa em aberto. Etapa desativada (Follow-up 2 a 4) recusa.
 */
export async function moveDealTx(tx: Tx, dealId: string, stageKey: string, userId: string | null, reason: string, at = new Date(), opts: AttemptStart = {}) {
  const [deal] = await tx.select().from(deals).where(eq(deals.id, dealId));
  if (!deal) throw new Error("Conversa não encontrada");
  const to = await stageByKey(stageKey, tx);
  if (deal.stageId === to.id) return deal;
  if (!to.active) throw new UserFacingError("Essa etapa foi desativada. Escolha outra.");
  const [from] = await tx.select().from(stages).where(eq(stages.id, deal.stageId));
  const closing = to.kind === "fechado" || to.kind === "perdido";
  if (deal.closedAt && !closing) {
    // Reabrir: só se o contato não tiver outro lead aberto (nunca dois abertos ao mesmo tempo).
    const other = await findOpenDeal(deal.contactId, tx);
    if (other && other.id !== deal.id) throw new ReopenConflict(other.id);
  }
  const sameWait = isWaitingKind(to.kind) && from?.kind === to.kind;
  // Saiu de uma etapa com tentativas correndo (Orçamento, ou Em conversa esperando a cliente): a tentativa em aberto é cancelada.
  if ((isWaitingKind(from?.kind) || (isAttemptKind(from?.kind) && deal.followupAttempt > 0)) && !sameWait) await cancelAttemptTaskTx(tx, deal, userId, at);
  let [updated] = await tx.update(deals).set({
    stageId: to.id, stageEnteredAt: at, closedAt: closing ? at : null,
    awaitingReplySince: closing ? null : deal.awaitingReplySince,
    ...(sameWait ? {} : { followupAttempt: 0, followupDueAt: null, followupTaskId: null }),
  }).where(eq(deals.id, dealId)).returning();
  if (closing) {
    // Lead fechado ou perdido não espera mais resposta: os alertas abertos se resolvem.
    await tx.update(alerts).set({ resolvedAt: at, readAt: sql`coalesce(${alerts.readAt}, ${at.toISOString()}::timestamptz)` })
      .where(and(eq(alerts.dealId, dealId), isNull(alerts.resolvedAt)));
  }
  await logEvent(tx, dealId, "etapa_alterada", { de: from?.key, para: to.key, motivo: reason }, userId);
  if (isWaitingKind(to.kind) && !sameWait && !opts.noAttempts) updated = await startAttemptsTx(tx, updated, to.kind, userId, at, opts);
  return updated;
}

/** Move para a etapa ativa de um TIPO (o código não depende das chaves). Já numa etapa desse tipo: não faz nada. */
export async function moveToKindTx(tx: Tx, dealId: string, kind: StageKind, userId: string | null, reason: string, at = new Date(), opts: AttemptStart = {}) {
  const [cur] = await tx.select({ deal: deals, kind: stages.kind }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, dealId));
  if (!cur) throw new Error("Conversa não encontrada");
  if (cur.kind === kind) return cur.deal;
  return moveDealTx(tx, dealId, (await stageByKind(kind, tx)).key, userId, reason, at, opts);
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
    const sigs = await signatureMap(tx);
    /** Quem assinou a mensagem da Casa no histórico (ou null). */
    const signer = (m: HistoryMessage) => { const s = m.fromMe ? parseSignature(m.body) : null; return s ? sigs.get(signatureKey(s)) ?? null : null; };
    const lastSigner = [...outbound].reverse().map(signer).find((s) => s !== null) ?? null;
    const contact = await upsertContact(tx, phone, name);
    let deal = await findOpenDeal(contact.id, tx);
    let created = false;
    if (!deal && !contact.ignored && now.getTime() - lastAt.getTime() <= HISTORY_LEAD_DAYS * 86_400_000) {
      const stage = await stageByKind(lastOut ? "atendimento" : "lead", tx);
      const clientWaiting = !quiet && lastIn && (!lastOut || lastIn > lastOut) && now.getTime() - lastIn.getTime() <= HISTORY_WAITING_HOURS * 3_600_000;
      const waitingSince = clientWaiting ? inbound.find((m) => !lastOut || m.at > lastOut)!.at : null;
      const origin = detectOrigin({ body: inbound[0]?.body, isClient: contact.isClient });
      [deal] = await tx.insert(deals).values({
        contactId: contact.id, stageId: stage.id, ownerId: (lastSigner?.active ? lastSigner.id : null) ?? await pickOwner(tx), channelId, origin, sourceLabel: detectSource({ body: inbound[0]?.body }),
        stageEnteredAt: now, createdAt: msgs[0].at, lastInboundAt: lastIn, lastOutboundAt: lastOut, awaitingReplySince: waitingSince,
        lastReplyById: lastSigner?.id ?? null, lastReplyVia: lastSigner ? "celular" : null,
      }).returning();
      await logEvent(tx, deal.id, "lead_criado", { origin, initialStage: stage.key, historico: true });
      created = true;
    }
    const dealId = deal?.id ?? (contact.ignored ? await latestArchivedDealId(contact.id, tx) : null);
    const rows = msgs.map((m) => ({
      dealId, contactId: contact.id, channelId, externalId: m.externalId, direction: m.fromMe ? "out" as const : "in" as const,
      kind: m.kind, body: m.body, media: m.media ?? null, quotedBody: m.quotedBody ?? null, status: m.fromMe ? "sent" : "received", fromPhone: m.fromMe, createdAt: m.at,
      sentByUserId: signer(m)?.id ?? null, sentVia: m.fromMe ? ("celular" as const) : null,
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
  if (!d) throw new Error("Conversa não encontrada");
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

/**
 * Há quanto tempo o lead espera resposta, em segundos de EXPEDIENTE (mesma conta do SLA e dos relatórios: `businessSecondsBetween`).
 * Usado no "Respondido em X ✓ dentro da meta" ao enviar. `null` se não há espera aberta.
 */
export async function waitedBusinessSeconds(dealId: string, now = new Date()): Promise<number | null> {
  const [d] = await db.select({ since: deals.awaitingReplySince }).from(deals).where(eq(deals.id, dealId));
  if (!d?.since) return null;
  return businessSecondsBetween(d.since.getTime(), now.getTime(), await getBusinessHours());
}
