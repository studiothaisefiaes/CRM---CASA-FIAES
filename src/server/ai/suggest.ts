import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db";
import { aiSuggestions, appointments, contacts, deals, lists, messages, professionals, stages, tasks, users } from "../db/schema";
import { emit } from "../domain/events";
import { numberContactIds } from "../domain/people-on-number";
import { getBusinessHours } from "../domain/hours";
import { getCasaInfo, getClientLinkSettings } from "../domain/client-link/settings";
import { summarizeHours } from "@/lib/hours-summary";
import { ACTIVE_STATUSES } from "@/lib/appointment-status";
import { stripSignature } from "@/lib/signature";
import { displayName } from "@/lib/display-name";
import { AiError, callLegivel, callSuggestion, type CallResult } from "./client";
import { garantirHorario, pareceRobo, semCumprimento, vaiVerificar } from "./pos";
import { getAiManual } from "./manual";
import { listPackageDefs } from "../domain/caixa/packages";
import { iaPodeIndicar, normalizeReplyLabel, quickReplyAttachment, quickReplyIaQuando } from "../domain/quick-replies";
import { buildSystem, buildUser, greetState, MAX_EXAMPLES, MAX_MESSAGES, MAX_PEDIDO_CHARS, resumoAntes, type CasaData, type Combinado, type ConversationData, type Material, type PromptMessage } from "./prompt";
import { loadEquipeContext } from "./contexto";
import { loadAusencias, loadClienteContext } from "./cliente";
import { costMicros } from "./pricing";
import { AGENDA_TAG, asksForSlots, cancelouSemData, dayMentions, hourLabel, hourMentions, isAgreement, mentionsTime, offeredSlot, pediuHorarioNovo, proFirstName } from "./horarios";
import { freeHoursLine, planSlots, slotStillFree } from "./horarios-agenda";
import { todayBahia } from "@/lib/agenda";
import { openDayAt } from "@/lib/next-action";
import { slotMs } from "@/lib/schedule";
import { confirmText, isConfirmation, type ProposedSlot } from "@/lib/proposed-slot";
import { aiEnv, aiSpend, budgetState, getAiSettings } from "./settings";

/**
 * Sugestão de resposta por IA para a atendente. NUNCA envia nada: grava a sugestão e avisa a tela (`ia_sugestao`).
 * A atendente toca "Usar" (o texto vai para a caixa de mensagem, editável) e ela mesma aperta Enviar.
 *
 * SOB DEMANDA (economia de tokens, pedido do dono): gera quando a atendente pede ("Sugerir resposta"/"Outra"), A QUALQUER MOMENTO (16/10):
 * a última é da Casa → a próxima mensagem natural da Casa; com tema → segue o tema; com mensagem citada → responde a ela.
 * A 1ª sugestão de cada PEDIDO (última mensagem + tema + citada) é "reservada" no banco antes da chamada (índice único): o mesmo pedido
 * de novo reaproveita a guardada, e duas pessoas juntas pagam uma vez.
 */

/** Reserva sem resposta há mais que isto (processo caiu no meio): pode ser refeita. */
export const STALE_CLAIM_MS = 2 * 60_000;

export type SkipReason =
  | "desligada" | "sem_chave" | "teto_mes" | "teto_dia" | "conversa_fechada" | "nao_e_cliente" | "equipe" | "nao_espera_resposta"
  | "ultima_da_casa" | "sem_mensagem" | "ja_tem" | "citada_sumiu" | "sem_consentimento_ia";
export type GenerateResult = { status: "gerada"; id: string; costMicros: number; usage: CallResult["usage"] } | { status: "pulada"; motivo: SkipReason } | { status: "falhou"; erro: string };

export type Caller = (input: { system: string; user: string }, o: { apiKey: string; model: string; baseUrl?: string }) => Promise<CallResult>;
const defaultCaller: Caller = (input, o) => callSuggestion(input, o);

/** O pedido da atendente: tema opcional ("mandar o endereço e como estacionar") e a mensagem marcada para responder. */
export type Pedido = { tema?: string | null; quotedId?: string | null };
export const normTema = (t: string | null | undefined) => (t ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_PEDIDO_CHARS);
/** A chave do pedido (coluna `pedido`): "" = sugestão comum; senão "<id da citada>|<tema em minúsculas>". */
export function pedidoKey(p: Pedido | null | undefined): string {
  const tema = normTema(p?.tema).toLocaleLowerCase("pt-BR");
  const q = p?.quotedId ?? "";
  return tema || q ? `${q}|${tema}` : "";
}

/** A resposta pronta pode ir como material: universal, com foto/vídeo E com "A IA indica quando…" (só o que a gestão liberou, como na lista do prompt). */
const materialValido = (meta: unknown) => iaPodeIndicar(meta) && !!quickReplyIaQuando(meta);

/** Materiais no bloco fixo (economia de tokens; a Casa tem poucos vídeos/fotos para indicar). */
export const MAX_MATERIAIS = 12;
/**
 * "Materiais para enviar" (24/10, o vídeo do Método Fiaes): as respostas prontas ativas, universais, com foto ou vídeo e com "A IA indica
 * quando…" preenchido, na ordem de Configurações. A IA pode indicar uma com a marca; quem decide enviar é a atendente.
 */
async function loadMateriais(): Promise<Material[]> {
  const rows = await db.select({ label: lists.label, body: lists.body, meta: lists.meta }).from(lists)
    .where(and(eq(lists.kind, "quick_reply"), eq(lists.active, true), sql`${lists.meta}->>'iaQuando' is not null`)).orderBy(asc(lists.position));
  return rows.filter((r) => materialValido(r.meta)).slice(0, MAX_MATERIAIS)
    .map((r) => ({ atalho: r.label, kind: quickReplyAttachment(r.meta)!.kind as Material["kind"], quando: quickReplyIaQuando(r.meta)!, inicio: r.body ?? "" }));
}

/**
 * O atalho da marca `[[material:/atalho]]`, conferido: resposta pronta que existe, ativa e é material válido. Senão null (a marca é
 * ignorada): a IA não prende um vídeo que a gestão não liberou, nem adivinhando um atalho que existe.
 */
async function materialReplyId(atalho: string | null | undefined): Promise<string | null> {
  const l = atalho ? normalizeReplyLabel(atalho) : "";
  if (!l) return null;
  const [r] = await db.select({ id: lists.id, meta: lists.meta }).from(lists).where(and(eq(lists.kind, "quick_reply"), eq(lists.label, l), eq(lists.active, true))).limit(1);
  return r && materialValido(r.meta) ? r.id : null;
}

/** O anexo que a sugestão indicou, se ainda vale (a resposta pode ter sido desativada, virado pessoal, perdido a foto/vídeo ou o "quando" depois). */
async function materialOf(replyId: string | null): Promise<CurrentSuggestion["material"]> {
  if (!replyId) return null;
  const [r] = await db.select({ meta: lists.meta, active: lists.active }).from(lists).where(and(eq(lists.id, replyId), eq(lists.kind, "quick_reply")));
  const a = r?.active && materialValido(r.meta) ? quickReplyAttachment(r.meta) : null;
  return a ? { replyId, name: a.name, kind: a.kind as "image" | "video" } : null;
}

/** O bloco fixo: serviços ativos com preço e descrição, horário, endereço, o prazo de cancelamento do link, o Manual da Casa e os materiais. */
export async function loadCasaData(): Promise<CasaData> {
  const [services, hours, casa, link, manual, packages, pros, team, assistants, materiais] = await Promise.all([
    // Só o que a cliente pode saber: nunca o custo do serviço (0084).
    db.select({ label: lists.label, priceCents: lists.priceCents, priceKind: lists.priceKind, durationMin: lists.durationMin, category: lists.category, description: lists.description })
      .from(lists).where(and(eq(lists.kind, "service"), eq(lists.active, true), eq(lists.aiCitavel, true))).orderBy(asc(lists.position), asc(lists.label)),
    getBusinessHours(), getCasaInfo(), getClientLinkSettings(), getAiManual(), listPackageDefs({ activeOnly: true }),
    db.select({ name: professionals.name }).from(professionals).where(eq(professionals.active, true)),
    db.select({ name: users.name }).from(users).where(eq(users.active, true)),
    db.select({ name: professionals.name }).from(professionals).where(and(eq(professionals.active, true), isNotNull(professionals.assistantOf))),
    loadMateriais(),
  ]);
  return {
    services, hours: summarizeHours(hours), address: casa.endereco, cancelUntilHours: link.cancelarAteHoras, manual: manual.secoes,
    nomes: [...pros, ...team].map((p) => p.name.trim().split(/\s+/)[0] ?? "").filter(Boolean),
    assistentes: assistants.map((a) => a.name),
    packages: packages.map((p) => ({ name: p.name, priceCents: p.priceCents, sessions: Math.max(1, ...p.items.map((i) => i.sessions)), services: p.serviceLabels, validityDays: p.validityDays, description: p.description })),
    materiais,
  };
}

type DealRow = { id: string; ownerId: string | null; closedAt: Date | null; archivedAt: Date | null; conversationArchivedAt: Date | null; awaitingReplySince: Date | null; lastOutboundAt: Date | null; scheduledAt: Date | null;
  contactId: string; name: string | null; ignored: boolean; isTeam: boolean; consentAi: boolean | null; stage: string; serviceId: string | null; serviceLabel: string | null };

async function loadDeal(dealId: string): Promise<DealRow | null> {
  const [d] = await db.select({
    id: deals.id, ownerId: deals.ownerId, closedAt: deals.closedAt, archivedAt: deals.archivedAt, conversationArchivedAt: deals.conversationArchivedAt, awaitingReplySince: deals.awaitingReplySince, lastOutboundAt: deals.lastOutboundAt,
    scheduledAt: deals.scheduledAt, contactId: deals.contactId, name: contacts.name, ignored: contacts.ignored, isTeam: contacts.isTeam, consentAi: contacts.consentAi, stage: stages.name, serviceId: deals.serviceId, serviceLabel: lists.label,
  }).from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).innerJoin(stages, eq(stages.id, deals.stageId)).leftJoin(lists, eq(lists.id, deals.serviceId))
    .where(eq(deals.id, dealId));
  return d ?? null;
}

const lastMessageOf = async (dealId: string) =>
  (await db.select({ id: messages.id, direction: messages.direction }).from(messages)
    .where(eq(messages.dealId, dealId)).orderBy(desc(messages.createdAt), desc(messages.id)).limit(1))[0] ?? null;

/** Mensagens antes das recentes que entram no resumo "Antes disso" (custo zero: o resumo é montado aqui, sem IA). */
export const MAX_OLDER = 300;
const msgCols = { id: messages.id, direction: messages.direction, kind: messages.kind, body: messages.body, transcript: messages.transcript, at: messages.createdAt,
  quoted: messages.quotedBody, sentByUserId: messages.sentByUserId, fromPhone: messages.fromPhone };
type MsgRow = { id: string; direction: "in" | "out"; kind: string; body: string | null; transcript: string | null; at: Date; quoted: string | null; sentByUserId: string | null; fromPhone: boolean };
/** Mensagem da Casa sem ninguém da equipe (lembrete, resposta fora do horário): automática. */
const toPrompt = (m: MsgRow): PromptMessage => ({ direction: m.direction, kind: m.kind, body: m.body, transcript: m.transcript, at: m.at, quoted: m.quoted,
  auto: m.direction === "out" && !m.sentByUserId && !m.fromPhone });

/** As mensagens recentes (mais antiga primeiro), o resumo do que ficou antes delas, as últimas respostas da equipe e o resumo anterior. */
async function loadMessages(dealId: string, until?: Date) {
  const before = until ? [lt(messages.createdAt, until)] : [];
  const recent: MsgRow[] = await db.select(msgCols)
    .from(messages).where(and(eq(messages.dealId, dealId), ...before, isNull(messages.deletedAt))).orderBy(desc(messages.createdAt), desc(messages.id)).limit(MAX_MESSAGES);
  const oldest = recent.at(-1);
  const older: MsgRow[] = oldest && recent.length >= MAX_MESSAGES
    ? await db.select(msgCols).from(messages).where(and(eq(messages.dealId, dealId), lt(messages.createdAt, oldest.at), isNull(messages.deletedAt)))
      .orderBy(desc(messages.createdAt), desc(messages.id)).limit(MAX_OLDER)
    : [];
  // Exemplos: o que alguém da equipe escreveu (pelo CRM ou pelo celular); mensagem automática não é o jeito da Casa.
  const examples = await db.select({ body: messages.body }).from(messages)
    .where(and(eq(messages.dealId, dealId), ...before, eq(messages.direction, "out"), eq(messages.kind, "text"), isNotNull(messages.body), sql`(${messages.sentByUserId} is not null or ${messages.fromPhone})`))
    .orderBy(desc(messages.createdAt)).limit(MAX_EXAMPLES);
  const lastId = recent[0]?.id;
  const [summary] = await db.select({ resumo: aiSuggestions.resumo }).from(aiSuggestions)
    .where(and(eq(aiSuggestions.dealId, dealId), ne(aiSuggestions.resumo, ""), ...(lastId ? [ne(aiSuggestions.lastMessageId, lastId)] : []), ...(until ? [lt(aiSuggestions.createdAt, until)] : [])))
    .orderBy(desc(aiSuggestions.createdAt)).limit(1);
  return { recent: recent.reverse().map(toPrompt), antes: resumoAntes(older.reverse().map(toPrompt)), examples: examples.reverse().map((e) => stripSignature(e.body).trim()).filter(Boolean), summary: summary?.resumo ?? null };
}

const principalPro = alias(professionals, "principal");

async function nextAppointment(d: DealRow, now: Date): Promise<ConversationData["nextAppointment"]> {
  // Várias pessoas no mesmo número (0051): o horário da filha/mãe também é desta conversa, com o nome DELA.
  // Assistente (17/10): para a cliente quem atende é a principal; a IA nunca cita a assistente como quem atende.
  const [a] = await db.select({ startsAt: appointments.startsAt, service: appointments.serviceLabel, professional: sql<string | null>`coalesce(${principalPro.name}, ${professionals.name})`, contactId: appointments.contactId, person: contacts.name })
    .from(appointments).leftJoin(professionals, eq(professionals.id, appointments.professionalId)).leftJoin(principalPro, eq(principalPro.id, professionals.assistantOf))
    .leftJoin(contacts, eq(contacts.id, appointments.contactId))
    .where(and(inArray(appointments.contactId, await numberContactIds(d.contactId)), gt(appointments.startsAt, now), inArray(appointments.status, [...ACTIVE_STATUSES])))
    .orderBy(asc(appointments.startsAt)).limit(1);
  if (a) return { startsAt: a.startsAt, service: a.service, professional: a.professional, forName: a.contactId !== d.contactId ? firstNameOf(a.person) : null };
  if (d.scheduledAt && d.scheduledAt > now) return { startsAt: d.scheduledAt, service: d.serviceLabel ?? "serviço a confirmar", professional: null };
  return null;
}

export const firstNameOf = (name: string | null) => {
  const f = name?.trim().split(/\s+/)[0] ?? "";
  // Nome de WhatsApp com número ou símbolo não é nome: melhor sem.
  return /^\p{L}[\p{L}'-]*$/u.test(f) ? f.charAt(0).toLocaleUpperCase("pt-BR") + f.slice(1).toLocaleLowerCase("pt-BR") : null;
};

/** A cliente desta conversa disse Não ao atendimento com ajuda da IA? (vale mesmo com a função de consentimento desligada) */
export async function consentAiBlocked(dealId: string): Promise<boolean> {
  return (await loadDeal(dealId))?.consentAi === false;
}

/**
 * Tudo o que vai na parte da conversa (só primeiro nome, etapa, próximo horário, resumo anterior e mensagens; nunca CPF, telefone, e-mail).
 * `until`: a conversa como estava antes desse instante (scripts/ai-avaliar.ts compara com a resposta que a Casa deu de verdade).
 */
export async function loadConversation(dealId: string, now = new Date(), until?: Date, opts: { equipe?: boolean; requesterId?: string | null } = {}) {
  const d = await loadDeal(dealId);
  if (!d) return null;
  // Disse Não ao atendimento com ajuda da IA: nada da conversa é carregado (cobre sugestão, "Escrever com IA" e avaliação).
  if (d.consentAi === false) return null;
  const [{ recent, antes, examples, summary }, appt, equipe, cliente, ausencias] = await Promise.all([loadMessages(dealId, until), nextAppointment(d, now),
    opts.equipe ? loadEquipeContext(d, opts.requesterId, now) : null, loadClienteContext(d.contactId, until ?? now), loadAusencias(now)]);
  const data: ConversationData = {
    firstName: firstNameOf(d.name), stage: d.stage, nextAppointment: appt, now, examples, previousSummary: summary, antes, equipe, cliente, ausencias,
    // A última fala da Casa: a de alguém da equipe nas mensagens recentes (lembrete e "fora do horário" automáticos não contam: 20/10,
    // a cliente que responde ao lembrete da manhã pode ser cumprimentada); sem nenhuma, a última da Casa; sem nada, a da conversa.
    lastCasaAt: (recent.filter((m) => m.direction === "out" && m.kind !== "call" && !m.auto).at(-1) ?? recent.filter((m) => m.direction === "out" && m.kind !== "call").at(-1))?.at
      ?? (until ? null : d.lastOutboundAt),
    messages: recent,
  };
  return { deal: d, last: recent.at(-1) ?? null, data };
}

export type Claim = { id: string; dealId: string; lastMessageId: string; origin: "auto" | "outra"; apiKey: string; model: string; baseUrl?: string;
  /** O pedido (tema e citada) e a chave dele; quem pediu (a mensagem sai como ela). */
  tema: string | null; quotedId: string | null; pedido: string; userId: string | null };

/** A mensagem citada, só se for da mesma cliente (a tela mostra todas as conversas dela). */
async function quotedMessage(contactId: string, id: string): Promise<PromptMessage | null> {
  const [m] = await db.select(msgCols).from(messages).where(and(eq(messages.id, id), eq(messages.contactId, contactId))).limit(1);
  return m ? toPrompt(m) : null;
}

/**
 * Confere tudo e RESERVA a chamada (linha sem texto). Não chama a IA.
 * - "auto" ("Sugerir resposta"): uma vez só por pedido (última mensagem + tema + citada), a qualquer momento (a última pode ser da Casa).
 *   `requireWaiting` (ao abrir a conversa): só com a cliente por último esperando a Casa (o "Obrigada!" depois da resposta não gasta nada).
 * - "outra": a atendente pediu outra para o mesmo pedido.
 * Sempre respeita a chave ligada, a chave da API e o teto do mês/dia.
 */
export async function claimSuggestion(dealId: string, opts: { origin?: "auto" | "outra"; requireWaiting?: boolean; userId?: string | null; now?: Date } & Pedido = {}): Promise<{ status: "reservada"; claim: Claim } | { status: "pulada"; motivo: SkipReason }> {
  const origin = opts.origin ?? "auto";
  const now = opts.now ?? new Date();
  const s = await getAiSettings();
  if (!s.enabled) return { status: "pulada", motivo: "desligada" };
  const { apiKey, model, baseUrl } = aiEnv();
  if (!apiKey) return { status: "pulada", motivo: "sem_chave" };
  const d = await loadDeal(dealId);
  // Resolvido (conversa arquivada), atendimento encerrado ou arquivado só bloqueiam o automático: a atendente pode pedir a qualquer
  // momento para retomar (17/10: a Cati continua conversas em que a Sara escreveu por último).
  if (!d || (opts.requireWaiting && (d.closedAt || d.archivedAt || d.conversationArchivedAt))) return { status: "pulada", motivo: "conversa_fechada" };
  if (d.ignored) return { status: "pulada", motivo: "nao_e_cliente" };
  // Disse Não ao atendimento com ajuda da IA (Fase B): nada dela vai para a IA. Vale mesmo com a função de consentimento desligada.
  if (d.consentAi === false) return { status: "pulada", motivo: "sem_consentimento_ia" };
  // Equipe também pode pedir (a Cati testa pelo número dela; pedido do dono 16/10): só gasta no clique.
  const last = await lastMessageOf(dealId);
  if (!last) return { status: "pulada", motivo: "sem_mensagem" };
  if (opts.requireWaiting && last.direction !== "in") return { status: "pulada", motivo: "ultima_da_casa" };
  if (opts.requireWaiting && !d.awaitingReplySince) return { status: "pulada", motivo: "nao_espera_resposta" };
  const quotedId = opts.quotedId && (await quotedMessage(d.contactId, opts.quotedId)) ? opts.quotedId : null;
  if (opts.quotedId && !quotedId) return { status: "pulada", motivo: "citada_sumiu" };
  const budget = budgetState(s, await aiSpend(now));
  if (budget !== "ok") return { status: "pulada", motivo: budget };
  const tema = normTema(opts.tema) || null;
  const pedido = pedidoKey({ tema, quotedId });
  const values = { dealId, lastMessageId: last.id, pedido, resumo: "", sugestao: "", model, origin, requestedBy: opts.userId ?? null, createdAt: now };
  const claimOf = (id: string): Claim => ({ id, dealId, lastMessageId: last.id, origin, apiKey, model, baseUrl, tema, quotedId, pedido, userId: opts.userId ?? null });
  if (origin === "outra") {
    const [row] = await db.insert(aiSuggestions).values(values).returning({ id: aiSuggestions.id });
    return { status: "reservada", claim: claimOf(row.id) };
  }
  // Reserva abandonada (o processo caiu no meio da chamada): libera para tentar de novo.
  await db.delete(aiSuggestions).where(and(eq(aiSuggestions.lastMessageId, last.id), eq(aiSuggestions.pedido, pedido), eq(aiSuggestions.origin, "auto"), eq(aiSuggestions.sugestao, ""),
    isNull(aiSuggestions.dismissedAt), lt(aiSuggestions.createdAt, new Date(now.getTime() - STALE_CLAIM_MS))));
  const [row] = await db.insert(aiSuggestions).values(values).onConflictDoNothing().returning({ id: aiSuggestions.id });
  if (!row) return { status: "pulada", motivo: "ja_tem" };
  return { status: "reservada", claim: claimOf(row.id) };
}

/**
 * As últimas mensagens da cliente que ainda esperam horário (até 4): as do fim e as de antes de uma resposta da Casa que NÃO trouxe
 * horário ("vou conferir e já te retorno" não responde a pergunta). Para numa resposta da Casa com horário (já respondida).
 */
export function pendingClientTexts(msgs: ConversationData["messages"]): string[] {
  const text = (m: ConversationData["messages"][number]) => (m.kind === "audio" ? m.transcript : m.body) ?? "";
  const out: string[] = [];
  for (let i = msgs.length - 1, seen = 0; i >= 0 && out.length < 4 && seen < 8; i--, seen++) {
    const m = msgs[i];
    if (m.direction === "out") { if (mentionsTime(stripSignature(m.body))) break; continue; }
    out.unshift(text(m));
  }
  return out;
}

/** `pediu`: a cliente pediu horário de verdade (`pediuHorario`), gatilho da garantia; `texts`: as mensagens dela que esperam resposta. */
type FreeHours = { line: string; options: ProposedSlot[]; fora: string | null; pediu: boolean; texts: string[] };
/**
 * Só quando as mensagens da cliente que esperam resposta (ou a citada, ou o tema) pedem horário: a linha curta de horários livres da agenda,
 * cada opção com id (h1…). `force`: lê mesmo sem pedido (o horário combinado não está mais livre). Nunca derruba a sugestão.
 */
async function freeHoursFor(d: Pick<DealRow, "id" | "contactId" | "serviceId">, c: ConversationData, now: Date, force: { texts: string[]; serviceId: string | null } | null = null): Promise<FreeHours | null> {
  const quoted = c.pedido?.citada;
  // Mensagem citada: é ela que pede (ou não) horário; senão as da cliente que esperam resposta. O tema também conta.
  const texts = quoted ? [(quoted.kind === "audio" ? quoted.transcript : quoted.body) ?? ""] : pendingClientTexts(c.messages);
  if (c.pedido?.tema) texts.push(c.pedido.tema);
  if (!asksForSlots(texts) && !force) return null;
  try {
    // O assunto Método também vem do resto da conversa (as mensagens recentes, das duas).
    const r = await freeHoursLine({ contactId: d.contactId, dealServiceId: force?.serviceId ?? d.serviceId, texts: [...(force?.texts ?? []), ...texts], now, context: c.messages.slice(-12).map(textOf) });
    return r && { ...r, pediu: pediuHorarioNovo(texts, { temHorario: !!c.nextAppointment }), texts };
  } catch (e) {
    console.error("[sugestão por IA] horários livres falharam", d.id, e);
    return null;
  }
}

const textOf = (m: ConversationData["messages"][number]) => (m.kind === "audio" ? m.transcript : m.body) ?? "";
const hmOf = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const minOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const WD = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
/** "sex 24/10 às 15h com Thaise (Avaliação)" (para a IA). */
export const slotPromptLabel = (s: ProposedSlot) =>
  `${WD[new Date(`${s.day}T12:00:00Z`).getUTCDay()]} ${s.day.slice(8, 10)}/${s.day.slice(5, 7)} às ${hourLabel(minOf(s.time))}${s.professionalName ? ` com ${proFirstName(s.professionalName)}` : ""}${s.serviceLabel ? ` (${displayName(s.serviceLabel.trim())})` : ""}`;

/** `slot`: o horário combinado (só quando está livre). `context`: textos e serviço para ler outros horários (quando não está mais livre). */
export type CombinadoResult = { prompt: Combinado; slot: ProposedSlot | null; context: { texts: string[]; serviceId: string | null } };
/**
 * A cliente concordou ("pode ser", "sim", "fechado", "quero", "a das 16h30") com o horário que a Casa ofereceu na última mensagem dela:
 * o horário vem da sugestão usada que propôs esse horário ou é lido da mensagem (dia, hora, profissional) e conferido na agenda.
 * Mais de um horário oferecido sem ela dizer qual: ambíguo (a IA pergunta). Não está mais livre: a IA avisa e oferece outro.
 */
export async function combinadoFor(d: Pick<DealRow, "id" | "contactId" | "serviceId">, c: ConversationData, now: Date): Promise<CombinadoResult | null> {
  if (c.pedido?.citada || c.pedido?.tema) return null;
  const msgs = c.messages;
  let k = msgs.length - 1;
  const client: string[] = [];
  const citadas: string[] = [];
  while (k >= 0 && msgs[k].direction === "in") { const q = msgs[k].quoted; if (q) citadas.unshift(q); client.unshift(textOf(msgs[k--])); }
  // Mensagem automática (fora do horário, lembrete) entre a oferta da Casa e o "fica sim": vale a última de alguém da equipe (20/10).
  while (k >= 0 && msgs[k].direction === "out" && msgs[k].auto) k--;
  const casa = msgs[k];
  if (!client.length || !casa || casa.direction !== "out" || casa.kind === "call") return null;
  // Ela citou (respondeu a) uma oferta da Casa com horário: é essa que ela aceitou.
  const citada = citadas.map((q) => stripSignature(q).trim()).filter((q) => mentionsTime(q)).at(-1);
  const casaText = citada ?? stripSignature(casa.body).trim();
  if (!mentionsTime(casaText) || !isAgreement(client)) return null;
  const before = msgs.slice(Math.max(0, k - 6), k).filter((m) => m.direction === "in").map(textOf);
  const pros = await db.select({ id: professionals.id, name: professionals.name }).from(professionals).where(eq(professionals.active, true));
  const off = offeredSlot({ casa: casaText, client, before, today: todayBahia(casa.at), pros });
  const context = { texts: [...before, casaText], serviceId: d.serviceId };
  if (off?.status === "ambiguo") return { prompt: { status: "ambiguo", opcoes: off.times.map(hourLabel).join("; ") }, slot: null, context };
  // A sugestão que a atendente usou com esse horário (a mensagem da Casa saiu dela): o horário guardado vale.
  const [used] = await db.select({ horario: aiSuggestions.horario }).from(aiSuggestions)
    .where(and(eq(aiSuggestions.dealId, d.id), isNotNull(aiSuggestions.usedAt), isNotNull(aiSuggestions.horario), lt(aiSuggestions.createdAt, casa.at)))
    .orderBy(desc(aiSuggestions.createdAt)).limit(1);
  const u = used?.horario ?? null;
  const said = hourMentions(casaText).map((h) => h.start);
  let slot: ProposedSlot | null = null;
  if (u && said.includes(minOf(u.time)) && (!off || (off.day === u.day && off.start === minOf(u.time)))) slot = { ...u, id: "hc", origem: "combinado" };
  else if (off) {
    const plan = await planSlots({ contactId: d.contactId, dealServiceId: d.serviceId, texts: [...before, casaText, ...client], now, context: msgs.slice(-12).map(textOf) });
    const proId = off.proId ?? (plan?.pros.length === 1 ? plan.pros[0].id : null);
    const pro = pros.find((p) => p.id === proId) ?? null;
    // A regra do serviço (ex.: avaliação do Método só com a Thaise) vale também para o que a Casa digitou: não vira horário para marcar.
    if (plan?.ruled && pro && !plan.pros.some((p) => p.id === pro.id)) {
      const label = `${slotPromptLabel({ id: "hc", day: off.day, time: hmOf(off.start), professionalId: pro.id, professionalName: pro.name, serviceId: plan.svc?.id ?? null, serviceLabel: plan.svc?.label ?? null, durationMin: plan.durationMin, origem: "combinado" })}`;
      return { prompt: { status: "regra", label, so: plan.pros.map((p) => proFirstName(p.name)).join(" ou ") }, slot: null, context: { ...context, serviceId: plan.svc?.id ?? d.serviceId } };
    }
    slot = { id: "hc", day: off.day, time: hmOf(off.start), professionalId: pro?.id ?? null, professionalName: pro?.name ?? null,
      serviceId: plan?.svc?.id ?? null, serviceLabel: plan?.svc?.label ?? null, durationMin: plan?.durationMin ?? 60, origem: "combinado" };
  }
  if (!slot) return null;
  // Já está marcado para ela (lembrete da véspera, "Correto"): a agenda a conta como ocupada por ela mesma; nunca é "não está livre".
  const [mine] = await db.select({ id: appointments.id }).from(appointments).where(and(inArray(appointments.contactId, await numberContactIds(d.contactId)),
    eq(appointments.startsAt, new Date(slotMs(slot.day, slot.time))), inArray(appointments.status, [...ACTIVE_STATUSES]))).limit(1);
  if (mine) return { prompt: { status: "ja_marcado", label: slotPromptLabel(slot) }, slot: null, context };
  const free = await slotStillFree(slot, d.contactId, now);
  if (free === false) return { prompt: { status: "ocupado", label: slotPromptLabel(slot) }, slot: null, context: { ...context, serviceId: slot.serviceId ?? d.serviceId } };
  return { prompt: { status: "ok", label: slotPromptLabel(slot), confirm: confirmText(slot) }, slot, context };
}

/**
 * O horário que a sugestão propôs, conferido: o id que a IA devolveu tem que existir (opção da lista ou "hc") e a mensagem tem que falar
 * daquela hora. Sem id (ou id que não existe): a primeira hora citada na mensagem que bate com uma opção (desempata pela profissional e
 * pelo dia citados). Concordância: o horário combinado vem sempre (o cartão mostra para a atendente conferir).
 */
export function resolveHorario(id: string | null | undefined, options: ProposedSlot[], combinado: ProposedSlot | null, text: string, today: string): ProposedSlot | null {
  const hours = hourMentions(text).map((h) => h.start);
  const key = id?.trim().toLowerCase() ?? "";
  const byId = key === "hc" ? combinado : options.find((o) => o.id === key) ?? null;
  if (byId && (byId === combinado || hours.includes(minOf(byId.time)))) return byId;
  if (combinado) return combinado;
  for (const h of hours) {
    let c = options.filter((o) => minOf(o.time) === h);
    if (c.length > 1) {
      const t = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const byPro = c.filter((o) => o.professionalName && new RegExp(`\\b${proFirstName(o.professionalName).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()}\\b`).test(t));
      if (byPro.length) c = byPro;
      const days = new Set(dayMentions(text, today).map((d) => d.day));
      const byDay = c.filter((o) => days.has(o.day));
      if (byDay.length) c = byDay;
    }
    if (c.length === 1) return c[0];
    if (c.length) return null;
  }
  return null;
}

export const ROBO_MOTIVO = "parece mensagem automática de empresa";
const NO_USAGE = { inputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
/**
 * A última leva "da cliente" é robô ou propaganda de empresa (cobrança, protocolo, boleto): nem chama a IA (sem custo). Volta pedindo alguém
 * da equipe, com resposta curta e neutra, sem oferecer serviço. Com tema ou mensagem citada, a atendente pediu: segue normal.
 */
export function roboResult(data: ConversationData, model: string): CallResult | null {
  if (data.pedido?.tema || data.pedido?.citada) return null;
  const burst: string[] = [];
  for (const m of [...data.messages].reverse()) { if (m.direction !== "in") break; burst.unshift(textOf(m)); }
  if (!burst.length || !pareceRobo(burst)) return null;
  return { data: { resumo: "Mensagem automática de empresa (cobrança/propaganda), não parece cliente.", sugestao: "Recebido, obrigada!", precisa_humano: true, motivo: ROBO_MOTIVO, horario: "" },
    usage: NO_USAGE, costMicros: 0, model };
}

/** "Vou verificar"/"já te retorno" com horários na mão: proibido (src/server/ai/pos.ts → `vaiVerificar`; a avaliação conta). */
export const saysWillCheck = vaiVerificar;

/** Tudo o que vai para a IA (também usado pela avaliação, scripts/ai-avaliar.ts): os dois blocos, as opções de horário e o combinado. */
export async function prepareRequest(d: Pick<DealRow, "id" | "contactId" | "serviceId">, data: ConversationData, casa: CasaData, now: Date) {
  const combinado = await combinadoFor(d, data, now);
  // Combinado que não está mais livre: lê os livres mesmo sem pedido, para a IA oferecer outro.
  const free = await freeHoursFor(d, data, now, combinado?.prompt.status === "ocupado" || combinado?.prompt.status === "regra" ? combinado.context : null);
  const user = buildUser({ ...data, freeHours: free?.line, combinado: combinado?.prompt ?? null });
  return { system: buildSystem(casa), user, free, combinado, greet: greetState(data) };
}

/**
 * O acabamento do servidor depois da IA (também usado pela avaliação): a garantia do horário concreto (pos.ts → `garantirHorario`) e o
 * horário da sugestão (o botão "Marcar este horário"). A garantia vale com a cliente pedindo horário de verdade, ou com o combinado que
 * não vale mais (ocupado ou fora da regra); nunca com o combinado ok, ambíguo ou já marcado. `garantido`: o servidor mexeu no texto.
 */
export function finalizar(sugestao0: string, horarioId: string | null | undefined, req: Pick<Awaited<ReturnType<typeof prepareRequest>>, "free" | "combinado"> & { greet?: ReturnType<typeof greetState>;
  /** A atendente disse o que quer ("Sobre o quê?"): o pedido dela manda, o servidor não cola horário no texto (20/10, caso Uirá). */ temaDado?: boolean }, now: Date, assistentes: string[] = []):
  { sugestao: string; horario: ProposedSlot | null; garantido: boolean } {
  // Conversa em andamento: o cumprimento do começo sai ("Oii, Fulana! Tudo bem?" no meio da conversa, avaliação de coerência 20/10).
  const sugestao = req.greet === "andamento" ? semCumprimento(sugestao0) : sugestao0;
  const k = req.combinado?.prompt.status;
  const options = req.free?.options ?? [];
  const pediu = k ? k === "ocupado" || k === "regra" : !!req.free?.pediu;
  if (k === "ja_marcado") return { sugestao, horario: null, garantido: false };
  if (req.temaDado) return { sugestao, horario: resolveHorario(horarioId, options, req.combinado?.slot ?? null, sugestao, todayBahia(now)), garantido: false };
  const g = sugestao ? garantirHorario(sugestao, { opcoes: options, pediu, textosCliente: req.free?.texts ?? [], hoje: todayBahia(now), fora: req.free?.fora ?? null, assistentes }) : null;
  const text = g?.texto ?? sugestao;
  const horario = g?.horario ?? (text ? resolveHorario(horarioId, options, req.combinado?.slot ?? null, text, todayBahia(now)) : null);
  return { sugestao: text, horario, garantido: !!g?.trocou };
}

/** Sem o número de dias da IA: 3 semanas (o meio dos 15 a 30 dias que a Cati pediu). A IA pode dizer de 7 a 45. */
export const RETOMAR_PADRAO_DIAS = 21;
/** Horário desta pessoa (ou de outra no mesmo número) cancelado na agenda nos últimos 14 dias. */
async function canceladoNaAgenda(contactId: string, now: Date): Promise<boolean> {
  const [a] = await db.select({ id: appointments.id }).from(appointments).where(and(inArray(appointments.contactId, await numberContactIds(contactId)),
    eq(appointments.status, "cancelado"), gt(appointments.cancelledAt, new Date(now.getTime() - 14 * 86_400_000)))).limit(1);
  return !!a;
}
/** As últimas mensagens da cliente (a leva do fim; com a Casa por último, a leva dela antes da resposta da Casa). */
function ultimaLevaDaCliente(msgs: ConversationData["messages"]): string[] {
  let i = msgs.length - 1;
  while (i >= 0 && msgs[i].direction === "out") i--;
  const out: string[] = [];
  for (; i >= 0 && msgs[i].direction === "in" && out.length < 6; i--) out.unshift(textOf(msgs[i]));
  return out;
}
/**
 * Cancelou sem nova data (Cati 17/10: "a IA programa um retorno mais para frente"): QUANDO retomar o contato, às 10h de um dia em que a Casa
 * abre. Só proposta (a retomada nasce no toque "Programar retomada"). Nunca com horário futuro marcado, retomada já aberta ou horário proposto.
 * A IA diz os dias (`retomar_dias`) e o servidor confere que houve cancelamento (mensagens dela ou a agenda); a IA esqueceu, mas a última
 * leva dela cancela sem pedir outra data → 3 semanas.
 */
export async function retomadaProposta(d: Pick<DealRow, "contactId">, data: ConversationData, dias: number | null | undefined, horario: ProposedSlot | null, now: Date): Promise<Date | null> {
  if (data.nextAppointment || data.equipe?.retomada || horario) return null;
  const n = dias && dias > 0 ? dias : 0;
  const leva = cancelouSemData(ultimaLevaDaCliente(data.messages));
  const ok = leva || (n > 0 && (cancelouSemData(data.messages.slice(-12).filter((m) => m.direction === "in").map(textOf)) || await canceladoNaAgenda(d.contactId, now)));
  if (!ok) return null;
  return openDayAt(now.getTime(), n > 0 ? Math.min(45, Math.max(7, n)) : RETOMAR_PADRAO_DIAS, 10, await getBusinessHours());
}

/** Faz a chamada da reserva e grava o resultado (ou libera a reserva). Avisa a tela em qualquer caso. */
export async function fillSuggestion(claim: Claim, opts: { caller?: Caller; now?: Date } = {}): Promise<GenerateResult> {
  const now = opts.now ?? new Date();
  try {
    const [conv, casa] = await Promise.all([loadConversation(claim.dealId, now, undefined, { equipe: true, requesterId: claim.userId }), loadCasaData()]);
    if (!conv) throw new Error("conversa sumiu");
    const previous = claim.origin === "outra"
      ? (await db.select({ sugestao: aiSuggestions.sugestao }).from(aiSuggestions)
        .where(and(eq(aiSuggestions.lastMessageId, claim.lastMessageId), eq(aiSuggestions.pedido, claim.pedido), ne(aiSuggestions.sugestao, ""))).orderBy(asc(aiSuggestions.createdAt))).map((p) => p.sugestao)
      : undefined;
    const citada = claim.quotedId ? await quotedMessage(conv.deal.contactId, claim.quotedId) : null;
    const data: ConversationData = { ...conv.data, previous, pedido: claim.tema || citada ? { tema: claim.tema, citada } : null };
    const robo = roboResult(data, claim.model);
    const req = robo ? { system: "", user: "", free: null, combinado: null, greet: null } : await prepareRequest(conv.deal, data, casa, now);
    // Texto embaralhado: pede de novo 1 vez; o texto que fica já vem pós-processado (src/server/ai/pos.ts).
    const r = robo ?? await callLegivel(() => (opts.caller ?? defaultCaller)({ system: req.system, user: req.user }, { apiKey: claim.apiKey, model: claim.model, baseUrl: claim.baseUrl }), casa.nomes);
    const motivo = r.data.precisa_humano ? r.data.motivo || null : null;
    // Horário concreto garantido pelo servidor (pediu horário e há horário livre) e o horário da sugestão (botão "Marcar este horário").
    const { sugestao, horario } = robo ? { sugestao: r.data.sugestao, horario: null } : finalizar(r.data.sugestao, r.data.horario, { ...req, temaDado: !!claim.tema?.trim() }, now, casa.assistentes);
    // Ofereceu horário da lista: marca no motivo (sem coluna nova) para a tela avisar "confira antes de enviar".
    const usedAgenda = !!req.free?.options.length && mentionsTime(sugestao);
    // Cancelou sem nova data: quando retomar (proposta; nada é criado aqui).
    const retomarEm = robo ? null : await retomadaProposta(conv.deal, data, r.data.retomar_dias, horario, now);
    // Material indicado pela IA (a marca já saiu do texto em callLegivel): só se a resposta pronta existe e vale; senão é ignorado.
    const quickReplyId = robo ? null : await materialReplyId(r.data.material);
    await db.update(aiSuggestions).set({
      resumo: r.data.resumo, sugestao, precisaHumano: r.data.precisa_humano, motivo: usedAgenda ? `${AGENDA_TAG}${motivo ?? ""}` : motivo, model: r.model, horario, retomarEm, quickReplyId,
      inputTokens: r.usage.inputTokens, cachedTokens: r.usage.cachedTokens, cacheWriteTokens: r.usage.cacheWriteTokens, outputTokens: r.usage.outputTokens, costUsdMicros: r.costMicros,
      // Resposta vazia (não devia acontecer): fica registrada e descartada.
      dismissedAt: sugestao ? null : now,
    }).where(eq(aiSuggestions.id, claim.id));
    return { status: "gerada", id: claim.id, costMicros: r.costMicros, usage: r.usage };
  } catch (e) {
    const err = e instanceof AiError ? e : null;
    if (err?.usage) {
      // A Anthropic cobrou (fora do formato, recusa): o custo entra no teto, numa linha descartada que a tela não mostra (e não repete sozinha).
      await db.update(aiSuggestions).set({ motivo: `falhou: ${err.code}`, inputTokens: err.usage.inputTokens, cachedTokens: err.usage.cachedTokens,
        cacheWriteTokens: err.usage.cacheWriteTokens, outputTokens: err.usage.outputTokens, costUsdMicros: costMicros(err.usage), dismissedAt: now }).where(eq(aiSuggestions.id, claim.id));
    } else {
      // Não cobrou (sem rede, tempo esgotado, chave errada): libera a reserva; abrir de novo tenta de novo.
      await db.delete(aiSuggestions).where(eq(aiSuggestions.id, claim.id));
    }
    console.error("[sugestão por IA] falhou", claim.dealId, err ? `${err.code}: ${err.message}` : e);
    return { status: "falhou", erro: err ? `${err.code}: ${err.message}` : String(e) };
  } finally {
    await emit("ia_sugestao", { dealId: claim.dealId });
  }
}

/**
 * Reserva e chama na hora (o "Outra" e o "Sugerir resposta", e os testes). "Sugerir resposta" de um pedido que já tem sugestão:
 * a guardada é reaproveitada ("ja_tem", sem gastar); se ela já foi usada, fechada ou falhou, a atendente está pedindo de novo → gera outra.
 */
export async function generateForDeal(dealId: string, opts: { origin?: "auto" | "outra"; requireWaiting?: boolean; userId?: string | null; now?: Date; caller?: Caller } & Pedido = {}): Promise<GenerateResult> {
  let c = await claimSuggestion(dealId, opts);
  if (c.status === "pulada" && c.motivo === "ja_tem" && !opts.requireWaiting && (await pedidoState(dealId, opts, opts.now)).state === "pode_pedir") c = await claimSuggestion(dealId, { ...opts, origin: "outra" });
  if (c.status === "pulada") return c;
  return fillSuggestion(c.claim, opts);
}

/** `agendaAt`: a sugestão ofereceu horários lidos da agenda nesse instante (a tela pede para conferir). */
export type CurrentSuggestion = { id: string; resumo: string; sugestao: string; precisaHumano: boolean; motivo: string | null; lastMessageId: string; createdAt: Date; agendaAt: Date | null;
  /** O horário que a sugestão propôs (botão "Marcar este horário"). */
  horario: ProposedSlot | null;
  /** Cancelou sem nova data: quando retomar (botão "Programar retomada"). */
  retomarEm: Date | null;
  /** A resposta pronta com foto/vídeo que a IA indicou: o "Usar" prende o anexo na caixa (o texto vai como legenda). */
  material: { replyId: string; name: string; kind: "image" | "video" } | null };
/**
 * O que a tela mostra para a ÚLTIMA mensagem da conversa (seja da cliente ou da Casa):
 * - "pronta": a sugestão mais nova dessa mensagem (de qualquer pedido; com `pedido`, só desse), se não foi usada nem fechada;
 * - "escrevendo": a reserva está em andamento;
 * - "pode_pedir": ainda não houve sugestão (o botão "Sugerir resposta" gera);
 * - "nada": desligada, sem chave, sem mensagem ou Não é cliente (conversa Resolvida ou encerrada continua podendo pedir, 17/10).
 * O botão nunca some (pedido do dono, 16/10): sugestão usada, fechada ou que falhou → "pode_pedir" com `again` (só gasta no clique).
 */
export type SuggestionState = { state: "pronta"; suggestion: CurrentSuggestion } | { state: "pode_pedir"; again?: boolean } | { state: "escrevendo" | "nada" };

export async function suggestionState(dealId: string, now = new Date(), pedido?: Pedido): Promise<SuggestionState> {
  if (!(await getAiSettings()).enabled || !aiEnv().apiKey) return { state: "nada" };
  const [d] = await db.select({ closedAt: deals.closedAt, archivedAt: deals.archivedAt, ignored: contacts.ignored }).from(deals)
    .innerJoin(contacts, eq(contacts.id, deals.contactId)).where(eq(deals.id, dealId));
  // O botão vale a qualquer momento (17/10): conversa Resolvida, atendimento encerrado ou arquivado também. Só "Não é cliente" não tem.
  if (!d || d.ignored) return { state: "nada" };
  return pedidoState(dealId, pedido ?? null, now);
}

async function pedidoState(dealId: string, pedido: Pedido | null, now = new Date()): Promise<SuggestionState> {
  const last = await lastMessageOf(dealId);
  if (!last) return { state: "nada" };
  const [s] = await db.select().from(aiSuggestions).where(and(eq(aiSuggestions.dealId, dealId), eq(aiSuggestions.lastMessageId, last.id),
    ...(pedido ? [eq(aiSuggestions.pedido, pedidoKey(pedido))] : []))).orderBy(desc(aiSuggestions.createdAt)).limit(1);
  if (!s) return { state: "pode_pedir" };
  if (!s.sugestao && !s.dismissedAt) return now.getTime() - s.createdAt.getTime() < STALE_CLAIM_MS ? { state: "escrevendo" } : { state: "pode_pedir" };
  if (s.usedAt || s.dismissedAt || !s.sugestao) return { state: "pode_pedir", again: true };
  const agenda = !!s.motivo?.startsWith(AGENDA_TAG);
  // Retomada proposta: some quando a conversa já tem retomada aberta (a atendente já programou, por aqui ou pelo Retomar…).
  const retomarEm = s.retomarEm && !(await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.dealId, dealId), eq(tasks.kind, "proxima_acao"), isNull(tasks.doneAt))).limit(1)).length ? s.retomarEm : null;
  const motivo = agenda ? s.motivo!.slice(AGENDA_TAG.length) || null : s.motivo;
  return { state: "pronta", suggestion: { id: s.id, resumo: s.resumo, sugestao: s.sugestao, precisaHumano: s.precisaHumano, motivo, lastMessageId: s.lastMessageId ?? last.id, createdAt: s.createdAt, agendaAt: agenda ? s.createdAt : null, horario: s.horario ?? null, retomarEm, material: await materialOf(s.quickReplyId) } };
}

/** "Usar" (o texto foi para a caixa de mensagem) ou fechar (X). Só marca; nada é enviado. */
export async function markSuggestion(id: string, dealId: string, what: "usada" | "fechada", now = new Date()): Promise<void> {
  await db.update(aiSuggestions).set(what === "usada" ? { usedAt: now } : { dismissedAt: now })
    .where(and(eq(aiSuggestions.id, id), eq(aiSuggestions.dealId, dealId), isNull(aiSuggestions.usedAt), isNull(aiSuggestions.dismissedAt)));
  await emit("ia_sugestao", { dealId });
}

/**
 * "Marcar este horário": confere de novo o horário da sugestão (existe, é desta conversa, continua livre agora) e devolve o que a folha
 * "Marcar horário" precisa para abrir preenchida. NÃO marca nada: quem marca é a atendente, no botão Marcar da folha.
 * `confirm`: o texto que vai para a caixa depois de marcar (a própria sugestão, se já é a confirmação; senão o padrão da Casa).
 */
export async function bookingFromSuggestion(id: string, dealId: string, now = new Date()): Promise<{ slot: ProposedSlot; livre: boolean | null; confirm: string } | null> {
  const [s] = await db.select({ horario: aiSuggestions.horario, sugestao: aiSuggestions.sugestao, contactId: deals.contactId }).from(aiSuggestions)
    .innerJoin(deals, eq(deals.id, aiSuggestions.dealId)).where(and(eq(aiSuggestions.id, id), eq(aiSuggestions.dealId, dealId)));
  if (!s?.horario) return null;
  const livre = await slotStillFree(s.horario, s.contactId, now);
  return { slot: s.horario, livre, confirm: isConfirmation(s.sugestao) ? s.sugestao : confirmText(s.horario) };
}
