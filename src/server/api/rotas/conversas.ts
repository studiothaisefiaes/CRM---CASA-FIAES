import { and, asc, desc, eq, gte, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { can, canSeeDealMoney } from "@/lib/permissions";
import { CONTACT_KINDS } from "@/lib/contact-kind";
import { conversationStatus, CONVERSATION_STATUSES } from "@/lib/conversation-status";
import { db } from "../../db";
import { contacts, deals, messages, stages, tasks, users } from "../../db/schema";
import type { SessionUser } from "../../auth/sessions-store";
import { assertCanActOnDeal, OUT_OF_SCOPE } from "../../domain/deal-scope";
import { listarEtapas } from "./funil";
import { assertDirectMove } from "../../domain/stage-move";
import { assertTransferTarget, claimDeal, transferDeal } from "../../domain/assign";
import { conversationStatusOf, setConversationStatus } from "../../domain/conversation-status";
import { findContactByPhone, startNewConversation } from "../../domain/new-client";
import { findOpenDeal, moveDeal } from "../../domain/deals";
import { holderIdOf } from "../../domain/people-on-number";
import { MAX_MEDIA_BYTES, sendFromCrm, sendMediaFromCrm } from "../../domain/send";
import { addNote } from "../../domain/notes";
import { getAutoMessage } from "../../domain/auto-message-settings";
import { tagsOf } from "../../domain/tags";
import { SOURCE_EXPR } from "../../reports/common";
import { canActOn } from "../../queries/conversation";
import { ApiErro, erroParaFora, lerCursor, pagina, rotaApi, zId, zInstante, zInstanteSaida, zLista, zPaginacao, zUm, zUuid } from "../rota";
import { buscaContato, telefoneDe, zBool, zContatoResumo, zInstanteOuNulo, zPessoa } from "./comum";

/**
 * Conversas (deals) pela API: as mesmas regras da Fila. Lista e por id: sem "Ver conversas de todas" (atendimento.todas), só as da
 * pessoa da chave e as sem dona (o `scopeCond` da Fila; por id, `conversaNoEscopo`). Toda escrita também passa por `assertCanActOnDeal`
 * (a chave "Atendente só mexe nas próprias"). Valores em R$ só para quem vê dinheiro (canSeeDealMoney).
 */
const GRUPO = "Conversas";
export { TEXTO_WHATSAPP_RECUSOU } from "../rota";

const zConversa = z.object({
  id: z.uuid(),
  contato: zContatoResumo.extend({ tipo: z.enum(CONTACT_KINDS) }),
  etapa: z.object({ chave: z.string(), nome: z.string(), tipo: z.string() }),
  dona: zPessoa,
  aberta: z.boolean().meta({ description: "Conversa em andamento (não fechada nem marcada como Não é cliente)." }),
  status: z.enum(CONVERSATION_STATUSES).meta({ description: "O status do cabeçalho da conversa: aberto (a cliente espera a Casa), aguardando (a vez é da cliente) ou resolvido (saiu da lista; volta sozinha se alguém escrever)." }),
  aguardando_resposta_desde: zInstanteOuNulo.meta({ description: "Desde quando a cliente espera a Casa responder (null = não espera)." }),
  ultima_mensagem_cliente_em: zInstanteOuNulo,
  ultima_mensagem_casa_em: zInstanteOuNulo,
  agendado_em: zInstanteOuNulo,
  origem: z.string(),
  valor_centavos: z.number().int().nullable(),
  criada_em: zInstanteSaida,
  fechada_em: zInstanteOuNulo,
});
const zConversaDetalhe = zConversa.extend({
  combinado: z.object({ id: z.uuid(), titulo: z.string(), vence_em: zInstanteSaida, responsavel: zPessoa }).nullable(),
  etiquetas: z.array(z.string()),
});

const owner = alias(users, "dona");
const cols = {
  id: deals.id, createdAt: deals.createdAt, closedAt: deals.closedAt, archivedAt: deals.archivedAt, conversationArchivedAt: deals.conversationArchivedAt,
  resolvedAt: deals.resolvedAt, awaitingReplySince: deals.awaitingReplySince, lastInboundAt: deals.lastInboundAt, lastOutboundAt: deals.lastOutboundAt,
  scheduledAt: deals.scheduledAt, valueCents: deals.valueCents, ownerId: deals.ownerId, ownerName: owner.name,
  contactId: contacts.id, contactName: contacts.name, phone: contacts.phoneE164, kind: contacts.kind,
  stageKey: stages.key, stageName: stages.name, stageKind: stages.kind, origem: sql<string>`${SOURCE_EXPR("deals")}`,
};
const consulta = () => db.select(cols).from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).innerJoin(stages, eq(stages.id, deals.stageId)).leftJoin(owner, eq(owner.id, deals.ownerId));

function conversaDe(r: Awaited<ReturnType<typeof consulta>>[number], money: boolean) {
  return {
    id: r.id,
    contato: { id: r.contactId, nome: r.contactName, telefone: telefoneDe(r.phone), tipo: r.kind },
    etapa: { chave: r.stageKey, nome: r.stageName, tipo: r.stageKind },
    dona: r.ownerId && r.ownerName ? { id: r.ownerId, nome: r.ownerName } : null,
    aberta: !r.closedAt && !r.archivedAt,
    status: conversationStatus({ archivedAt: r.conversationArchivedAt, awaitingSince: r.awaitingReplySince }), aguardando_resposta_desde: r.awaitingReplySince,
    ultima_mensagem_cliente_em: r.lastInboundAt, ultima_mensagem_casa_em: r.lastOutboundAt, agendado_em: r.scheduledAt,
    origem: r.origem, valor_centavos: money ? r.valueCents : null, criada_em: r.createdAt, fechada_em: r.closedAt,
  };
}

/**
 * Revisão de segurança 26/10: por id vale o mesmo filtro da lista. Sem "Ver conversas de todas" (atendimento.todas), só as da pessoa
 * da chave e as sem dona, com ou sem a chave "Atendente só mexe nas próprias" ligada.
 */
export const noEscopoDaLista = (user: Pick<SessionUser, "id" | "perms">, ownerId: string | null) => !ownerId || ownerId === user.id || can(user.perms, "atendimento.todas");

/** Conversa por id para a API: 404 se não existe, 403 se está fora do escopo da pessoa da chave (o da lista e o da tela). */
export async function conversaNoEscopo(user: SessionUser, id: string) {
  const [r] = await consulta().where(eq(deals.id, id));
  if (!r) throw new ApiErro(404, "Essa conversa não existe.");
  if (!noEscopoDaLista(user, r.ownerId) || !(await canActOn(user, id))) throw new ApiErro(403, OUT_OF_SCOPE);
  return r;
}

async function detalhe(user: SessionUser, id: string) {
  return detalheDe(user, await conversaNoEscopo(user, id));
}
/** O detalhe sem conferir o escopo de novo: depois de uma escrita já conferida (a conversa pode ter acabado de ir para outra pessoa). */
async function detalheDe(user: SessionUser, r: Awaited<ReturnType<typeof consulta>>[number]) {
  const id = r.id;
  const resp = alias(users, "responsavel");
  const [[acao], tags] = await Promise.all([
    db.select({ id: tasks.id, title: tasks.title, dueAt: tasks.dueAt, assigneeId: tasks.assigneeId, assigneeName: resp.name }).from(tasks).leftJoin(resp, eq(resp.id, tasks.assigneeId))
      .where(and(eq(tasks.dealId, id), eq(tasks.kind, "proxima_acao"), isNull(tasks.doneAt))).orderBy(asc(tasks.dueAt)).limit(1),
    tagsOf([r.contactId]),
  ]);
  return {
    ...conversaDe(r, canSeeDealMoney(user.perms)),
    combinado: acao ? { id: acao.id, titulo: acao.title, vence_em: acao.dueAt, responsavel: acao.assigneeId && acao.assigneeName ? { id: acao.assigneeId, nome: acao.assigneeName } : null } : null,
    etiquetas: (tags.get(r.contactId) ?? []).map((t) => t.name),
  };
}

export const listarConversas = rotaApi({
  metodo: "GET", caminho: "/conversas", escopo: "ler", perm: "atendimento.ver", grupo: GRUPO,
  resumo: "Lista as conversas",
  descricao: "Da mais nova para a mais velha. Sem a permissão \"Ver conversas de todas\", só as da pessoa da chave e as sem dona (como na Fila).",
  query: z.object({
    etapa: z.string().regex(/^[a-z0-9_]{1,40}$/i).optional().meta({ description: `Chave da etapa (a lista vem em GET /api/v1${listarEtapas.caminho}).` }),
    dona: z.union([zUuid, z.enum(["sem", "eu"])]).optional().meta({ description: "Id da dona, `eu` (a pessoa da chave) ou `sem` (sem dona)." }),
    q: z.string().trim().min(1).max(80).optional().meta({ description: "Nome ou telefone (qualquer formato)." }),
    abertas: zBool.default(true).meta({ description: "true (padrão): só as da lista de Conversas (não resolvidas, não fechadas, não Não é cliente). false: todas." }),
    ...zPaginacao,
  }),
  resposta: zLista(zConversa),
  handler: async ({ user, query }) => {
    const conds: (SQL | undefined)[] = [];
    if (!can(user.perms, "atendimento.todas")) conds.push(sql`(${deals.ownerId} = ${user.id} or ${deals.ownerId} is null)`);
    if (query.abertas) conds.push(isNull(deals.closedAt), isNull(deals.archivedAt), isNull(deals.conversationArchivedAt));
    if (query.etapa) conds.push(eq(stages.key, query.etapa));
    if (query.dona === "sem") conds.push(isNull(deals.ownerId));
    else if (query.dona === "eu") conds.push(eq(deals.ownerId, user.id));
    else if (query.dona) conds.push(eq(deals.ownerId, query.dona));
    if (query.q) conds.push(buscaContato(query.q));
    const c = lerCursor(query.cursor);
    if (c) conds.push(or(lt(deals.createdAt, c.em), and(eq(deals.createdAt, c.em), lt(deals.id, c.id))));
    const rows = await consulta().where(and(...conds)).orderBy(desc(deals.createdAt), desc(deals.id)).limit(query.limite + 1);
    const money = canSeeDealMoney(user.perms);
    const p = pagina(rows, query.limite, (r) => ({ em: r.createdAt, id: r.id }));
    return { dados: p.dados.map((r) => conversaDe(r, money)), proximo_cursor: p.proximo_cursor };
  },
});

export const verConversa = rotaApi({
  metodo: "GET", caminho: "/conversas/{id}", escopo: "ler", perm: "atendimento.ver", grupo: GRUPO,
  resumo: "Uma conversa", descricao: "Com o combinado aberto e as etiquetas da cliente.",
  params: zId, resposta: zUm(zConversaDetalhe),
  handler: async ({ user, params }) => ({ dados: await detalhe(user, params.id) }),
});

export const TEXTO_CONVERSA_DE_OUTRA = "Essa cliente já tem uma conversa aberta com outra pessoa da equipe. Peça para ela ou para a gestão transferir.";

export const novaConversa = rotaApi({
  metodo: "POST", caminho: "/conversas", escopo: "escrever", perm: "atendimento.ver", grupo: GRUPO, status: 201,
  resumo: "Abre (ou acha) a conversa de um telefone",
  descricao: "O mesmo \"Nova conversa\" da tela: acha ou cadastra o contato pelo telefone e devolve a conversa pronta para escrever. Não envia nada. Sem \"Ver conversas de todas\", se a cliente já tem conversa aberta com outra pessoa: 409 (sem o id).",
  corpo: z.object({ telefone: z.string().trim().min(1).max(40), nome: z.string().trim().max(120).optional() }),
  resposta: zUm(z.object({ id: z.uuid(), criada: z.boolean(), contato_novo: z.boolean() })),
  handler: async ({ user, body, alvo }) => {
    // A cliente já tem conversa aberta com outra pessoa (fora do escopo): recusa antes de mexer no contato e sem devolver o id dela.
    const achado = await findContactByPhone(body.telefone);
    if (achado.contact) {
      const aberta = await findOpenDeal(await holderIdOf(achado.contact.id));
      if (aberta && !noEscopoDaLista(user, aberta.ownerId)) throw new ApiErro(409, TEXTO_CONVERSA_DE_OUTRA);
    }
    const r = await startNewConversation({ phone: body.telefone, name: body.nome }, user.id);
    // De novo depois: a conversa pode ter aberto no meio do caminho (mensagem que chegou, número oculto que foi juntado).
    const [d] = await db.select({ ownerId: deals.ownerId }).from(deals).where(eq(deals.id, r.dealId));
    if (d && !noEscopoDaLista(user, d.ownerId)) throw new ApiErro(409, TEXTO_CONVERSA_DE_OUTRA);
    alvo(r.dealId);
    return { dados: { id: r.dealId, criada: r.created, contato_novo: r.newContact } };
  },
});

export const alterarConversa = rotaApi({
  metodo: "PATCH", caminho: "/conversas/{id}", escopo: "escrever", perm: ["atendimento.ver", "quadro.ver"], grupo: GRUPO,
  resumo: "Muda etapa, dona ou status",
  descricao: [
    "Pelas mesmas funções da tela. Antes de mudar qualquer coisa, confere tudo (permissões e escopo da chave); depois aplica na ordem etapa, dona, status.",
    "`etapa`: Agendado, Fechado e Perdido pedem dados e não entram por aqui (agende por POST /agenda). Precisa de Ver Conversas ou Ver Quadro.",
    "`dona_id`: a própria pessoa da chave = Assumir; outra pessoa = Transferir (precisa de \"Transferir e atribuir conversas\").",
    "`status`: o seletor do cabeçalho (aberto, aguardando, resolvido). Resolver manda a \"Mensagem ao resolver\" para a cliente quando ela está ligada em Configurações: aí a chave precisa do escopo `enviar`.",
  ].join("\n\n"),
  params: zId,
  corpo: z.object({
    etapa: z.string().min(1).max(40).optional(),
    dona_id: zUuid.optional(),
    status: z.enum(CONVERSATION_STATUSES).optional(),
  }).refine((b) => Object.values(b).some((v) => v !== undefined), { message: "Mande pelo menos um campo: etapa, dona_id ou status." }),
  resposta: zUm(zConversaDetalhe),
  handler: async ({ user, params, body, alvo, exigirEnvio }) => {
    const id = params.id;
    alvo(id);
    const atual = await conversaNoEscopo(user, id);
    // Tudo conferido antes da primeira escrita: um campo recusado não deixa os outros pela metade (e o escopo é o de antes de mudar).
    const ver = can(user.perms, "atendimento.ver");
    if ((body.dona_id !== undefined || body.status !== undefined) && !ver) throw new ApiErro(403, "Mudar dona ou status pede Ver Conversas (atendimento.ver).");
    if (body.dona_id !== undefined && body.dona_id !== user.id && !can(user.perms, "atendimento.transferir")) throw new ApiErro(403, "Você não tem permissão para transferir conversas (Transferir e atribuir conversas).");
    if (body.dona_id !== undefined && body.dona_id !== user.id) await assertTransferTarget(db, body.dona_id);
    if (body.status !== undefined && body.etapa === undefined && (atual.closedAt || atual.archivedAt)) throw new ApiErro(400, "Essa conversa não está mais aberta.");
    if (body.etapa !== undefined) {
      try { await assertDirectMove(body.etapa); } catch { throw new ApiErro(400, "Essa etapa pede dados (data, valor ou motivo) e não muda por aqui. Para agendar, use POST /agenda."); }
    }
    if (body.status === "resolvido" && (await conversationStatusOf(id)) !== "resolvido") {
      // Resolver põe na fila a "Mensagem ao resolver" quando ela está ligada (afterArchive): isso é mandar WhatsApp.
      const msg = await getAutoMessage("encerramento");
      if (msg.enabled && msg.text.trim()) exigirEnvio();
    }
    if (body.etapa !== undefined) await moveDeal(id, body.etapa, user.id, "manual");
    if (body.dona_id !== undefined) {
      if (body.dona_id === user.id) await claimDeal(id, user.id);
      else await transferDeal(id, body.dona_id, user.id);
    }
    if (body.status !== undefined) await setConversationStatus(id, body.status, user.id);
    // Sem conferir o escopo de novo: transferir a própria conversa é permitido e ela deixa de ser da pessoa da chave.
    const [depois] = await consulta().where(eq(deals.id, id));
    return { dados: await detalheDe(user, depois) };
  },
});

// ---------- Mensagens ----------

const zMensagem = z.object({
  id: z.uuid(),
  conversa_id: z.uuid().nullable(),
  direcao: z.enum(["entrada", "saida"]).meta({ description: "entrada = da cliente; saida = da Casa." }),
  tipo: z.string().meta({ description: "text, image, video, audio, document, sticker, call, location, contact…" }),
  texto: z.string().nullable(),
  transcricao: z.string().nullable().meta({ description: "Áudio: a transcrição, quando pronta." }),
  midia: z.object({ mime: z.string().nullable(), duracao_s: z.number().nullable() }).nullable(),
  citacao: z.string().nullable(),
  status: z.string(),
  erro: z.string().nullable().meta({ description: "Por que não saiu (texto da Casa; o do provedor do WhatsApp não vem)." }),
  enviada_por: zPessoa,
  via: z.enum(["celular", "crm"]).nullable(),
  apagada: z.boolean(),
  editada: z.boolean(),
  criada_em: zInstanteSaida,
});
const autor = alias(users, "autor");
const msgCols = {
  id: messages.id, dealId: messages.dealId, direction: messages.direction, kind: messages.kind, body: messages.body, transcript: messages.transcript,
  transcriptStatus: messages.transcriptStatus, mediaMime: messages.mediaMime, mediaPath: messages.mediaPath, mediaDurationSec: messages.mediaDurationSec,
  hasMedia: sql<boolean>`(${messages.media} is not null or ${messages.mediaPath} is not null)`, quotedBody: messages.quotedBody, status: messages.status,
  error: messages.error, sentByUserId: messages.sentByUserId, sentByName: autor.name, sentVia: messages.sentVia, deletedAt: messages.deletedAt,
  editedAt: messages.editedAt, createdAt: messages.createdAt,
};
const mensagemDe = (m: Awaited<ReturnType<typeof msgsQuery>>[number]) => ({
  id: m.id, conversa_id: m.dealId, direcao: m.direction === "in" ? "entrada" : "saida", tipo: m.kind,
  // Apagada: o texto não vai (a tela mostra "mensagem apagada").
  texto: m.deletedAt ? null : m.body,
  transcricao: m.transcriptStatus === "pronta" ? m.transcript : null,
  midia: m.hasMedia ? { mime: m.mediaMime, duracao_s: m.mediaDurationSec } : null,
  citacao: m.quotedBody, status: m.status, erro: erroParaFora(m.error),
  enviada_por: m.sentByUserId && m.sentByName ? { id: m.sentByUserId, nome: m.sentByName } : null,
  via: m.sentVia, apagada: !!m.deletedAt, editada: !!m.editedAt, criada_em: m.createdAt,
});
const msgsQuery = () => db.select(msgCols).from(messages).leftJoin(autor, eq(autor.id, messages.sentByUserId));

export const listarMensagens = rotaApi({
  metodo: "GET", caminho: "/conversas/{id}/mensagens", escopo: "ler", perm: "atendimento.ver", grupo: GRUPO,
  resumo: "Mensagens da conversa",
  descricao: "Todas as mensagens do número da cliente (a conversa é unificada pelo número, como na tela), da mais nova para a mais velha. As apagadas \"só aqui\" não vêm; as apagadas para todos vêm com `apagada: true` e sem texto. O arquivo da mídia não vem pela API.",
  params: zId, query: z.object({ ...zPaginacao, desde: zInstante.optional().meta({ description: "Só as mensagens a partir deste instante." }) }),
  resposta: zLista(zMensagem),
  handler: async ({ user, params, query }) => {
    const c = await conversaNoEscopo(user, params.id);
    const cur = lerCursor(query.cursor);
    const rows = await msgsQuery().where(and(
      eq(messages.contactId, c.contactId), isNull(messages.hiddenAt),
      query.desde ? sql`${messages.createdAt} >= ${query.desde.toISOString()}::timestamptz` : undefined,
      cur ? or(lt(messages.createdAt, cur.em), and(eq(messages.createdAt, cur.em), lt(messages.id, cur.id))) : undefined,
    )).orderBy(desc(messages.createdAt), desc(messages.id)).limit(query.limite + 1);
    const p = pagina(rows, query.limite, (m) => ({ em: m.createdAt, id: m.id }));
    return { dados: p.dados.map(mensagemDe), proximo_cursor: p.proximo_cursor };
  },
});

/** Mensagem recém-gravada pelo envio: devolve como na lista (o status diz se saiu: sent, failed, simulado…). */
async function mensagemPorId(id: string | null) {
  if (!id) return null;
  const [m] = await msgsQuery().where(eq(messages.id, id));
  return m ? mensagemDe(m) : null;
}
const idDoEnvio = (r: unknown) => (r && typeof r === "object" && "messageId" in r && typeof r.messageId === "string" ? r.messageId : null);

/** Revisão de segurança 26/10: escrever para quem não escreveu nas últimas 24 h é disparo, não atendimento. */
export const JANELA_CLIENTE_MS = 24 * 3_600_000;
export const TEXTO_FORA_DA_JANELA = "A cliente não escreveu nas últimas 24 h (ou nunca escreveu): mandar mensagem para ela pela API pede a permissão \"Mandar mensagem em massa\" (mensagem.massa) no perfil da pessoa da chave.";
async function assertJanelaDaCliente(user: SessionUser, contactId: string) {
  if (can(user.perms, "mensagem.massa")) return;
  const [m] = await db.select({ id: messages.id }).from(messages)
    .where(and(eq(messages.contactId, contactId), eq(messages.direction, "in"), gte(messages.createdAt, new Date(Date.now() - JANELA_CLIENTE_MS)))).limit(1);
  if (!m) throw new ApiErro(403, TEXTO_FORA_DA_JANELA);
}

export const enviarMensagem = rotaApi({
  metodo: "POST", caminho: "/conversas/{id}/mensagens", escopo: "enviar", perm: "atendimento.ver", grupo: GRUPO, status: 201,
  resumo: "Envia mensagem pelo WhatsApp",
  descricao: [
    "Manda para a cliente, NA HORA, pelo mesmo caminho do campo de mensagem da tela (assinatura da pessoa da chave na primeira linha, conta como resposta, sai da espera). Não tem volta.",
    "Texto: JSON `{ \"texto\": \"…\" }` (até 4.000 caracteres). Arquivo: multipart/form-data com `arquivo` (foto, PDF, áudio ou vídeo, até 16 MB; o tipo é conferido pelos bytes) e `legenda` opcional.",
    "`citar_mensagem_id` responde citando uma mensagem desta conversa.",
    "Cliente que não escreveu nas últimas 24 h (ou nunca escreveu): pede também a permissão \"Mandar mensagem em massa\" (mensagem.massa) no perfil; sem ela, 403.",
    "Limites de envio (429): 20 por minuto por chave, 20 por minuto por pessoa (somando as chaves dela) e, na Casa toda pela API, 30 por minuto e 500 por dia.",
  ].join("\n\n"),
  params: zId,
  corpo: z.object({ texto: z.string().min(1).max(4000), citar_mensagem_id: zUuid.optional() }),
  multipart: z.object({
    arquivo: z.string().meta({ format: "binary", description: "Foto, PDF, áudio ou vídeo (até 16 MB)." }),
    legenda: z.string().max(1000).optional(),
    citar_mensagem_id: zUuid.optional(),
  }),
  resposta: zUm(zMensagem.nullable()),
  handler: async ({ user, params, body, form, alvo, exigirEnvio }) => {
    alvo(params.id);
    const c = await conversaNoEscopo(user, params.id);
    await assertCanActOnDeal(user, params.id);
    if (form) {
      const file = form.get("arquivo");
      if (!(file instanceof File) || !file.size) throw new ApiErro(400, "arquivo: escolha um arquivo para enviar.");
      if (file.size > MAX_MEDIA_BYTES) throw new ApiErro(400, "O arquivo passa de 16 MB. Escolha um menor.");
      const legenda = z.string().max(1000, "Legenda muito longa (máximo 1.000 caracteres).").nullish().parse(form.get("legenda") || null);
      const citar = zUuid.nullish().parse(form.get("citar_mensagem_id") || null);
      await assertJanelaDaCliente(user, c.contactId);
      // Tudo conferido: só agora conta nos limites de envio.
      exigirEnvio();
      const r = await sendMediaFromCrm(params.id, { name: file.name, mime: file.type, data: Buffer.from(await file.arrayBuffer()) }, legenda ?? null, user.id, { quoteMessageId: citar });
      return { dados: await mensagemPorId(idDoEnvio(r)) };
    }
    if (!body) throw new ApiErro(400, "Mande JSON com `texto` ou multipart com `arquivo`.");
    await assertJanelaDaCliente(user, c.contactId);
    exigirEnvio();
    const r = await sendFromCrm(params.id, body.texto, user.id, { quoteMessageId: body.citar_mensagem_id ?? null });
    return { dados: await mensagemPorId(idDoEnvio(r)) };
  },
});

export const novaNota = rotaApi({
  metodo: "POST", caminho: "/conversas/{id}/notas", escopo: "escrever", perm: "atendimento.ver", grupo: GRUPO, status: 201,
  resumo: "Nota interna na conversa",
  descricao: "A cliente não vê. `mencoes`: ids da equipe que recebem o aviso no sino (até 10). Até 2.000 caracteres.",
  params: zId,
  corpo: z.object({ texto: z.string().min(1).max(2000), assunto: z.string().max(120).optional(), mencoes: z.array(zUuid).max(10).optional() }),
  resposta: zUm(z.object({ id: z.uuid(), avisadas: z.number().int() })),
  handler: async ({ user, params, body, alvo }) => {
    alvo(params.id);
    await conversaNoEscopo(user, params.id);
    await assertCanActOnDeal(user, params.id);
    const r = await addNote({ dealId: params.id, body: body.texto, subject: body.assunto ?? null, mentions: body.mencoes ?? [] }, user.id);
    return { dados: { id: r.id, avisadas: r.notified } };
  },
});
