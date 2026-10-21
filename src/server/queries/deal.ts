import { pauseOf } from "@/lib/consent";
import type { MessageToolsState } from "@/lib/message-tools-state";
import { NO_TOOLS } from "@/lib/message-tools-state";
import { alias } from "drizzle-orm/pg-core";
import { listTags, tagsOf } from "../domain/tags";
import { listProfessionals } from "../domain/professionals";
import { getAgendaMode } from "../domain/agenda/mode";
import { clientContext } from "./client-context";
import { lateExists } from "./late-count";
import { teamNameCol, teamNameOf } from "./team-name";
import { notesOf } from "../domain/notes";
import { scheduledOf } from "../domain/scheduled";
import { replyVarsOf } from "./reply-vars";
import { quickRepliesFor } from "../domain/quick-replies";
import { firstName } from "@/lib/authorship";
import { and, asc, desc, eq, getTableColumns, gt, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "../db";
import { aiSuggestions, contacts, dealEvents, deals, leadSources, lists, messages, stages, tasks, users, channels } from "../db/schema";
import { SOURCE_EXPR } from "../reports/common";
import { NOT_IDENTIFIED } from "../../lib/source-kinds";
import { HISTORY_EVENT_LIMIT } from "../../lib/history";
import { attemptDaysOf, isAttemptKind, projectedLostAt } from "../../lib/attempts";
import { getBusinessHours } from "../domain/hours";
import { peopleOnNumber } from "../domain/people-on-number";
import { canReceiveConversation } from "../domain/team-scope";
import { listTeams } from "../domain/teams";
import { funcaoLigada } from "../domain/funcoes";
import { PRESENCE_TIMEOUT_MIN } from "../domain/distribution";

// O nó de mídia (com miniatura) fica no servidor; a tela pede o arquivo em /api/media/[id].
const { media: _media, ...msgCols } = getTableColumns(messages);

/** Campos de dinheiro no histórico: sem "ver valores" (nem registrar venda), somem da linha do tempo. */
const MONEY_FIELDS = new Set(["valueCents", "paidCents", "paymentMethod", "chargeAt"]);
function withoutMoney(type: string, payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const p = { ...(payload as Record<string, unknown>) };
  if (Array.isArray(p.campos)) p.campos = (p.campos as unknown[]).filter((c) => !(c && typeof c === "object" ? MONEY_FIELDS.has(String((c as { campo?: unknown }).campo)) : MONEY_FIELDS.has(String(c))));
  if (type === "venda") { delete p.valueCents; delete p.paidCents; }
  return p;
}

/** O histórico não repete a conversa: mensagens e "lido" ficam fora (e não gastam o limite). */
const CONVERSATION_EVENTS = ["mensagem_recebida", "mensagem_enviada", "lido"];

/** `money: false`: sem o valor das vendas (lead e leads anteriores), para quem não vê valores nem registra venda. */
/** Para o "Transferir para…": quem está disponível, o nível na distribuição e quantas conversas esperam resposta de cada pessoa. */
const teamForTransfer = () => db.select({ id: users.id, name: users.name, availability: users.availability, priorityLevel: users.priorityLevel,
  waiting: sql<number>`(select count(*)::int from deals w where w.owner_id = "users"."id" and w.closed_at is null and w.archived_at is null and w.awaiting_reply_since is not null)` })
  .from(users).where(and(eq(users.active, true), canReceiveConversation())).orderBy(asc(users.name));

/** Setores para o "Passar para…": só os ativos e só com a função Setores ligada (desligada, a seção some). */
export async function teamsForPass(): Promise<{ id: string; name: string; livres: number }[]> {
  if (!(await funcaoLigada("setores"))) return [];
  const since = new Date(Date.now() - PRESENCE_TIMEOUT_MIN * 60_000);
  const rows = await listTeams();
  return Promise.all(rows.filter((t) => t.active).map(async (t) => {
    const ids = t.members.map((m) => m.id);
    const [r] = ids.length ? await db.select({ n: sql<number>`count(*)::int` }).from(users)
      .where(and(inArray(users.id, ids), eq(users.active, true), eq(users.availability, "disponivel"), gt(users.lastSeenAt, since))) : [{ n: 0 }];
    return { id: t.id, name: t.name, livres: r.n };
  }));
}

/** `viewer`: quem abre a conversa. Decide as respostas prontas pessoais que aparecem, o {meu_nome} e se pode criar universais (gestão). */
/** As listas que a conversa e as folhas usam vão para o navegador da equipe: nunca o custo do serviço (0084, só com servicos.custo). */
const { costCents: _custo, ...LIST_COLS } = getTableColumns(lists);
void _custo;

export async function getDealDetail(id: string, opts: { money?: boolean; viewer?: { id: string; name: string; canShare: boolean; /** Biblioteca ligada e permissão de enviar: o clipe mostra “Da biblioteca”. */ canLibrary?: boolean; /** Reagir, editar, Como chegar e Mandar contato: permissão do perfil E função ligada. */ tools?: MessageToolsState } } = {}) {
  const money = opts.money ?? true;
  const [row] = await db.select({ deal: deals, contact: contacts, stage: stages, ownerName: users.name, lastReplyName: teamNameOf(deals.lastReplyById), resolvedByName: teamNameOf(deals.resolvedById), channelName: channels.name, channelStatus: channels.status })
    .from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).innerJoin(stages, eq(stages.id, deals.stageId))
    .leftJoin(users, eq(users.id, deals.ownerId)).leftJoin(channels, eq(channels.id, deals.channelId))
    .where(eq(deals.id, id)).limit(1);
  if (!row) return null;
  const assignee = alias(users, "assignee");
  const [msgs, events, listRows, people, stageList, history, [src], [nextAction], sourceRows, context, contactTagMap, tagOptions, pros, late, notes, scheduled, replyVars, quickReplies, agendaMode, [ai]] = await Promise.all([
    db.select({ m: msgCols, sender: teamNameCol(), hasMedia: sql<boolean>`(${messages.media} is not null or ${messages.mediaPath} is not null)` })
      .from(messages).leftJoin(users, eq(users.id, messages.sentByUserId))
      .where(and(eq(messages.contactId, row.contact.id), isNull(messages.hiddenAt))).orderBy(desc(messages.createdAt), desc(messages.id)).limit(200), // id: desempate estável no mesmo instante
    db.select({ e: dealEvents, user: users.name }).from(dealEvents).leftJoin(users, eq(users.id, dealEvents.userId))
      .where(and(eq(dealEvents.dealId, id), notInArray(dealEvents.type, CONVERSATION_EVENTS))).orderBy(desc(dealEvents.createdAt)).limit(HISTORY_EVENT_LIMIT),
    db.select(LIST_COLS).from(lists).where(eq(lists.active, true)).orderBy(asc(lists.position)),
    teamForTransfer(),
    db.select().from(stages).where(eq(stages.active, true)).orderBy(asc(stages.position)),
    db.select({ id: deals.id, createdAt: deals.createdAt, closedAt: deals.closedAt, stage: stages.name, valueCents: deals.valueCents })
      .from(deals).innerJoin(stages, eq(stages.id, deals.stageId))
      .where(and(eq(deals.contactId, row.contact.id))).orderBy(desc(deals.createdAt)).limit(10),
    // A mesma origem da Fila e dos relatórios: `source_label` (link/QR/evidência); sem ela, "Não identificada". Nunca o canal ("WhatsApp").
    db.select({ label: sql<string>`${SOURCE_EXPR("deals")}` }).from(deals).where(eq(deals.id, id)),
    // A próxima ação: UMA aberta por lead (a mais próxima, se houver legado com mais de uma).
    db.select({ id: tasks.id, title: tasks.title, dueAt: tasks.dueAt, assigneeId: tasks.assigneeId, assigneeName: assignee.name }).from(tasks)
      .leftJoin(assignee, eq(assignee.id, tasks.assigneeId))
      .where(and(eq(tasks.dealId, id), eq(tasks.kind, "proxima_acao"), isNull(tasks.doneAt))).orderBy(asc(tasks.dueAt)).limit(1),
    db.select({ id: leadSources.id, label: leadSources.label, active: leadSources.active }).from(leadSources).orderBy(asc(leadSources.label)),
    clientContext(row.contact.id, id, { money }),
    tagsOf([row.contact.id]),
    listTags(),
    listProfessionals({ all: true }),
    // Alerta de espera aberto: a única coisa que pinta a espera de vermelho (a regra do sino, da Fila e do Quadro).
    db.execute(sql`select ${lateExists(sql`${id}::uuid`)} as late`).then((r) => !!(r.rows[0] as { late?: boolean } | undefined)?.late),
    notesOf(row.contact.id),
    scheduledOf(row.contact.id),
    replyVarsOf(id),
    quickRepliesFor(opts.viewer?.id ?? null),
    getAgendaMode(),
    // Resumo da IA guardado (só lê; gerar é no botão "Sugerir resposta").
    db.select({ resumo: aiSuggestions.resumo, at: aiSuggestions.createdAt }).from(aiSuggestions).where(eq(aiSuggestions.dealId, id)).orderBy(desc(aiSuggestions.createdAt)).limit(1),
  ]);
  const [hours, phonePeople, passTeams, pauseSwitch] = await Promise.all([getBusinessHours(), peopleOnNumber(row.contact.id), teamsForPass(), funcaoLigada("pausa_automaticas")]);
  const paused = pauseOf(row.contact.automationsPausedUntil, new Date());
  return {
    ...row,
    /** Automáticas pausadas: "sempre", até quando (ISO) ou null; `pauseSwitch` = a função está ligada (sem ela o interruptor some, a pausa gravada continua valendo). */
    pause: paused === null ? null : paused === "sempre" ? "sempre" : paused.toISOString(),
    pauseSwitch,
    /** Setores para o "Passar para…" (vazio com a função Setores desligada). */
    teams: passTeams,
    /** Pessoas neste número (0051): o titular (a conversa) e quem mais usa o número (filha, mãe…). */
    phonePeople,
    /** Conversas de número oculto que a Casa começou há pouco por outro aparelho e podem ser desta cliente ("É dela", 17/10). */
    // CPF visível para a equipe (pedido do dono, 16/10: "só a gente tem acesso").
    contact: row.contact,
    /** "Tentativa 2 de 3 · vira Perdido sex": a previsão do Perdido "Não respondeu mais" (null sem tentativas). */
    attempt: row.deal.followupAttempt > 0 && isAttemptKind(row.stage.kind) ? {
      n: row.deal.followupAttempt,
      lostAt: projectedLostAt({ attempt: row.deal.followupAttempt, dueMs: row.deal.followupDueAt?.getTime() ?? null, startedMs: row.deal.stageEnteredAt.getTime(),
        days: attemptDaysOf(row.stage.kind, row.stage.attemptDays) }, hours)?.toISOString() ?? null,
    } : null,
    late,
    /** O que a cliente quer, pelo último resumo da IA (null sem sugestão gerada). */
    aiResumo: ai?.resumo ? { text: ai.resumo, at: ai.at.toISOString() } : null,
    deal: money ? row.deal : { ...row.deal, valueCents: null, paidCents: null },
    messages: msgs.reverse().map(({ m, sender, hasMedia }) => ({ ...m, sender, hasMedia })),
    events: events.map(({ e, user }) => ({ ...e, user, payload: money ? e.payload : withoutMoney(e.type, e.payload) })),
    /** O detalhe veio com valores em R$ (a tela esconde os campos de valor quando não). */
    money,
    objections: listRows.filter((l) => l.kind === "objection"),
    lostReasons: listRows.filter((l) => l.kind === "lost_reason"),
    /** Respostas prontas por pasta (a ordem dentro da pasta é a de Configurações) e com o anexo, se houver (Lote 5). */
    /** As universais + as de quem vê (`mine`, selo "Minha"). */
    quickReplies,
    /** Quem vê pode criar respostas universais e transformar pessoais em universais (gestão). */
    canShareReplies: !!opts.viewer?.canShare,
    canLibrary: !!opts.viewer?.canLibrary,
    tools: opts.viewer?.tools ?? NO_TOOLS,
    origins: listRows.filter((l) => l.kind === "origin"),
    services: listRows.filter((l) => l.kind === "service"),
    sourceLabel: src?.label ?? NOT_IDENTIFIED,
    nextAction: nextAction ?? null,
    /** Origens de link/QR (para o "Como conheceu?" e para o nome nas mudanças do histórico). */
    sources: sourceRows,
    people, stages: stageList, history: history.filter((h) => h.id !== id).map((h) => (money ? h : { ...h, valueCents: null })),
    /** Quem é a cliente (cartão de contexto / bloco "Quem é"): só o que o CRM registrou; valores só com `money`. */
    context,
    /** Etiquetas da cliente e todas as que existem (para sugerir ao escrever). */
    tags: contactTagMap.get(row.contact.id) ?? [],
    tagOptions: tagOptions.map((t) => t.name),
    /** Profissionais (todas, para o nome no histórico; Agendar oferece só as ativas). */
    professionals: pros,
    /** Notas internas da cliente (Lote 5): entram na conversa pela hora, nunca em `messages`. */
    notes,
    /** Mensagens agendadas que ainda vão sair (Lote 5). */
    scheduled,
    /** Valores das variáveis nesta conversa (Lote 5); {meu_nome} é o primeiro nome de quem vê. */
    replyVars: { ...replyVars, meuNome: firstName(opts.viewer?.name) },
    /** Modo da agenda (6A): fora de "consulta", "Agendar horário" abre o Marcar da Agenda. */
    agendaMode,
  };
}
export type DealDetail = NonNullable<Awaited<ReturnType<typeof getDealDetail>>>;

/** O que as folhas de agendar, fechar venda e perdido precisam do lead (usado ao soltar um card do Quadro): sem a conversa, o histórico nem os dados do contato. */
export type SheetDeal = Pick<DealDetail, "deal" | "stage" | "stages" | "services" | "lostReasons" | "people" | "professionals" | "agendaMode"> & { nextAction: DealDetail["nextAction"] | null; teams?: DealDetail["teams"] };
export async function getDealSheetData(id: string): Promise<SheetDeal | null> {
  const [row] = await db.select({ deal: deals, stage: stages }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, id)).limit(1);
  if (!row) return null;
  const [listRows, people, stageList, pros, agendaMode, passTeams] = await Promise.all([
    db.select(LIST_COLS).from(lists).where(and(eq(lists.active, true), inArray(lists.kind, ["service", "lost_reason"]))).orderBy(asc(lists.position)),
    teamForTransfer(),
    db.select().from(stages).where(eq(stages.active, true)).orderBy(asc(stages.position)),
    listProfessionals({ all: true }),
    getAgendaMode(),
    teamsForPass(),
  ]);
  return { ...row, agendaMode, teams: passTeams, services: listRows.filter((l) => l.kind === "service"), lostReasons: listRows.filter((l) => l.kind === "lost_reason"), people, stages: stageList, professionals: pros, nextAction: null };
}
