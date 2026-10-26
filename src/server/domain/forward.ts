import { and, asc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { db } from "../db";
import { alerts, contacts, messages } from "../db/schema";
import { ensureMedia } from "../whatsapp/media";
import { UserFacingError } from "./errors";
import { assertFuncaoLigada, funcaoParam, funcaoTexto } from "./funcoes";
import { emit } from "./events";
import { sendFromCrm, sendMediaFromCrm, UncertainSendError } from "./send";
import { stripSignature } from "@/lib/signature";
import { alertText, clientLabel } from "@/lib/alert-copy";
import { deals } from "../db/schema";

/** Padrão do número de destinos (o valor que vale está em Configurações › Recursos › Encaminhar mensagem, `max_destinos`). */
export const FORWARD_MAX = 10;
const KINDS = ["text", "image", "video", "audio", "document"] as const;
const GONE: Record<string, string> = { image: "Essa foto", video: "Esse vídeo", audio: "Esse áudio", document: "Esse documento" };
const WHEN = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia", hourCycle: "h23" });
const when = (d: Date) => WHEN.format(d).replace(", ", " às ").replace(/^(\d\d\/\d\d) (\d)/, "$1 $2");

/** Depois de um envio sem resposta do WhatsApp, o que faltava não é tentado (seria mais um tempo esgotado de até 60 s por envio). */
export const FORWARD_STOPPED = "Não foi tentado: o WhatsApp parou de responder. Confira e encaminhe de novo.";
const ITEM: Record<string, string> = { text: "mensagem", image: "foto", video: "vídeo", audio: "áudio", document: "documento" };

/** Destino que não recebeu tudo. `messageIds`: as mensagens que não chegaram nele (ausente = o destino inteiro falhou, nada saiu). */
export type ForwardFailure = { dealId: string; error: string; messageIds?: string[] };

/**
 * Encaminha uma mensagem (texto, foto, vídeo, áudio ou documento) para até `max_destinos` conversas.
 * Para conversa de Equipe vai com o cabeçalho "Encaminhada da conversa com {nome}, {data}:"; para cliente vai só o conteúdo,
 * sem nome nem telefone de origem. Um destino que falha não impede os outros. A permissão e o escopo são conferidos pela action.
 * É o caso de uma só de `forwardMessages`; com uma mensagem, falhar nela é falhar o destino (por isso some o `messageIds`).
 */
export async function forwardMessage(messageId: string, toDealIds: string[], userId: string): Promise<{ sent: number; failed: { dealId: string; error: string }[] }> {
  const r = await forwardMessages([messageId], toDealIds, userId);
  return { sent: r.sent, failed: r.failed.map(({ dealId, error }) => ({ dealId, error })) };
}

type Row = typeof messages.$inferSelect;
type Item = { m: Row; text: string; file: { name: string; mime: string; data: Buffer } | null; gone: string | null };
/** O pedido já conferido (limites, mesma conversa, o que dá para encaminhar) e com as mídias lidas do disco, pronto para sair. */
export type ForwardPlan = { items: Item[]; header: string; single: boolean };
export type ForwardOutcome = { sent: number; messages: number; failed: ForwardFailure[]; stopped?: true };

/**
 * Confere o pedido inteiro SEM enviar nada (a action chama antes de abrir conversa nova: pedido recusado não deixa conversa vazia na
 * Fila). Até `max_mensagens` mensagens da MESMA conversa (o mesmo contato, como a tela mostra) para `targetCount` destinos (até
 * `max_destinos`). Cada mídia é lida do disco aqui, uma vez só, não uma por destino; se nenhuma está mais guardada, recusa (com uma só,
 * é o recado de sempre).
 */
export async function prepareForward(messageIds: string[], targetCount: number): Promise<ForwardPlan> {
  await assertFuncaoLigada("encaminhar");
  const ids = [...new Set(messageIds)];
  if (!ids.length) throw new UserFacingError("Escolha as mensagens para encaminhar.");
  const maxMsgs = await funcaoParam("encaminhar", "max_mensagens");
  if (ids.length > maxMsgs) throw new UserFacingError(`Dá para encaminhar até ${maxMsgs} mensagens de uma vez.`);
  const max = await funcaoParam("encaminhar", "max_destinos");
  if (!targetCount) throw new UserFacingError("Escolha para quem encaminhar.");
  if (targetCount > max) throw new UserFacingError(`Dá para encaminhar para até ${max} conversas de uma vez.`);
  const rows = await db.select({ m: messages, name: contacts.name, phone: contacts.phoneE164 }).from(messages).innerJoin(contacts, eq(contacts.id, messages.contactId))
    .where(inArray(messages.id, ids)).orderBy(asc(messages.createdAt), asc(messages.id));
  if (rows.length !== ids.length) throw new UserFacingError(ids.length === 1 ? "Mensagem não encontrada." : "Uma das mensagens não foi encontrada.");
  // "Mesma conversa" é a da TELA: ela junta as mensagens do contato em todos os atendimentos dele (getDealDetail filtra por contactId), e a
  // cliente que volta depois de fechada ganha atendimento novo. Conferir por dealId recusava foto do mês passado + texto de hoje sem a
  // atendente ter como saber qual desmarcar. O escopo de cada mensagem (inclusive do atendimento antigo) a action confere uma por uma.
  if (new Set(rows.map((r) => r.m.contactId)).size > 1) throw new UserFacingError("As mensagens precisam ser da mesma conversa.");
  if (rows.some((r) => r.m.deletedAt || !(KINDS as readonly string[]).includes(r.m.kind)))
    throw new UserFacingError(ids.length === 1 ? "Essa mensagem não pode ser encaminhada." : "Uma das mensagens escolhidas não pode ser encaminhada.");

  const items: Item[] = [];
  for (const { m } of rows) {
    const text = m.direction === "out" ? stripSignature(m.body).trim() : (m.body ?? "").trim();
    if (m.kind === "text") { items.push({ m, text, file: null, gone: null }); continue; }
    const gone = `${GONE[m.kind]} não está mais guardad${m.kind === "image" || m.kind === "audio" ? "a" : "o"} no sistema.`;
    const f = m.mediaPurgedAt ? null : await ensureMedia(m.id);
    let file: Item["file"] = null;
    if (f) try { file = { name: f.name, mime: f.mime, data: await readFile(f.file) }; } catch { /* sumiu do disco: vale como não guardada */ }
    items.push({ m, text, file, gone: file ? null : gone });
  }
  const firstGone = items.find((i) => i.gone);
  if (firstGone && items.every((i) => i.gone)) throw new UserFacingError(firstGone.gone!);

  const nome = rows[0].name?.trim() || rows[0].phone;
  const single = items.length === 1;
  const header = single
    ? (await funcaoTexto("encaminhar", "cabecalho_equipe")).replaceAll("{nome}", nome).replaceAll("{data}", when(items[0].m.createdAt))
    : (await funcaoTexto("encaminhar", "cabecalho_equipe_varias")).replaceAll("{nome}", nome);
  return { items, header, single };
}

/**
 * Envia um pedido já conferido (`prepareForward`). Em cada destino as mensagens saem na ordem em que foram escritas (created_at), uma
 * depois da outra, não na ordem em que foram marcadas. Cliente: só o conteúdo. Equipe: com uma mensagem, o cabeçalho de sempre junto
 * dela (com a data); com várias, o cabeçalho `cabecalho_equipe_varias` uma vez só no começo e cada item sem repetir (cabeçalho a cada foto
 * vira ruído no grupo). Mídia que não está mais guardada falha sozinha em todos os destinos e as outras saem. Uma mensagem que o WhatsApp
 * recusou num destino não impede as próximas, e um destino que falha não impede os outros. `sent` conta os destinos que receberam tudo;
 * `messages`, quantas iam para cada destino.
 */
export async function deliverForward(plan: ForwardPlan, toDealIds: string[], userId: string): Promise<ForwardOutcome> {
  const { items, header, single } = plan;
  const targets = [...new Set(toDealIds)];
  /** Uma mensagem num destino. `withHeader`: só no caso de uma, para Equipe (o cabeçalho vai junto, como antes). */
  const sendItem = async (dealId: string, it: Item, withHeader: boolean) => {
    const { m, text, file } = it;
    if (!file) return void (await sendFromCrm(dealId, withHeader ? `${header}\n${text}` : text, userId));
    if (m.kind === "audio") {
      if (withHeader) await sendFromCrm(dealId, header, userId); // áudio não aceita legenda
      return void (await sendMediaFromCrm(dealId, file, null, userId));
    }
    // Documento sem legenda própria mostra o nome do arquivo; a legenda da foto/vídeo acompanha.
    const own = m.kind === "document" ? null : text || null;
    await sendMediaFromCrm(dealId, file, withHeader ? [header, own].filter(Boolean).join("\n") : own, userId);
  };
  const errorOf = (e: unknown) => (e instanceof Error ? e.message : "Não foi possível encaminhar.");

  // WhatsApp que não respondeu (timeout/rede: UncertainSendError) pode ter recebido. Seguir em série custaria mais um tempo esgotado (até
  // 60 s) por envio, e quem tenta de novo na dúvida manda em dobro. Então para tudo o que falta: o resto daquele destino e os destinos
  // seguintes voltam como não tentados, para conferir no WhatsApp e encaminhar de novo só o que faltou.
  let stopped = false;
  const out: ForwardOutcome = { sent: 0, messages: items.length, failed: [] };
  for (const dealId of targets) {
    if (stopped) { out.failed.push({ dealId, error: FORWARD_STOPPED }); continue; }
    try {
      const [d] = await db.select({ kind: contacts.kind }).from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).where(and(eq(deals.id, dealId)));
      if (!d) throw new UserFacingError("Conversa não encontrada.");
      const team = d.kind === "equipe";
      // Cabeçalho de várias: se nem ele sai, o destino falhou inteiro (mandar as mensagens soltas no grupo, sem a origem, confunde).
      if (team && !single) await sendFromCrm(dealId, header, userId);
      const bad: { id: string; error: string }[] = [];
      let uncertain: string | null = null;
      for (const it of items) {
        if (stopped || it.gone) { bad.push({ id: it.m.id, error: it.gone ?? FORWARD_STOPPED }); continue; }
        try { await sendItem(dealId, it, team && single); } catch (e) {
          if (e instanceof UncertainSendError) { stopped = true; uncertain = errorOf(e); }
          bad.push({ id: it.m.id, error: errorOf(e) });
        }
      }
      // O aviso mostra o recado da que não respondeu ("confira no WhatsApp"), não o "não foi tentado" das seguintes.
      if (bad.length) out.failed.push({ dealId, error: uncertain ?? bad[0].error, messageIds: bad.map((b) => b.id) });
      else out.sent++;
    } catch (e) {
      if (e instanceof UncertainSendError) stopped = true; // o cabeçalho da Equipe não respondeu
      out.failed.push({ dealId, error: errorOf(e) });
    }
  }
  return stopped ? { ...out, stopped: true } : out;
}

/**
 * Encaminha várias mensagens da MESMA conversa de uma vez (Cati 24/10: "selecionar como no WhatsApp") e espera todos os envios: confere
 * (`prepareForward`) e envia (`deliverForward`). A permissão e o escopo são conferidos pela action, que usa as duas partes separadas.
 */
export async function forwardMessages(messageIds: string[], toDealIds: string[], userId: string): Promise<ForwardOutcome> {
  const targets = [...new Set(toDealIds)];
  return deliverForward(await prepareForward(messageIds, targets.length), targets, userId);
}

/**
 * Envio em segundo plano (revisão 24/10): 12 vídeos para 3 conversas são 36 envios de até 60 s cada, e o "Para quem?" ficava preso no
 * spinner sem dizer nada. Agora a action confere tudo, devolve na hora e chama isto depois da resposta (`after`). Cada envio aparece na
 * conversa de destino como sempre (enviando → enviada/falhou), e o que não saiu vira aviso no sino de quem encaminhou, um por conversa,
 * dizendo quais mensagens e o motivo (o mesmo caminho da mensagem agendada que não saiu). Nunca lança: erro inesperado também vira aviso.
 */
export async function forwardInBackground(plan: ForwardPlan, toDealIds: string[], userId: string): Promise<void> {
  const run = randomUUID();
  try {
    const r = await deliverForward(plan, toDealIds, userId);
    for (const f of r.failed) await reportFailure(plan, f, userId, run);
    if (r.failed.length) await emit("alerta", { userId });
  } catch (e) {
    console.error("[encaminhar] erro inesperado no envio em segundo plano", e);
    const n = plan.items.length;
    await db.insert(alerts).values({ userId, audience: "responsavel", type: "encaminhar_falhou", severity: "info",
      message: alertText.forwardFailed(null, n === 1 ? "parou por um erro inesperado" : `parou por um erro inesperado (${n} mensagens)`, "Confira as conversas antes de mandar de novo."),
      dedupeKey: `encaminhar:${run}:erro` }).onConflictDoNothing().catch((err: unknown) => console.error("[encaminhar] não criou o aviso", err));
    await emit("alerta", { userId });
  }
}

/** Um aviso por conversa que não recebeu tudo: quais mensagens faltaram (tipo e hora, como ela acha na conversa) e o motivo. */
async function reportFailure(plan: ForwardPlan, f: ForwardFailure, userId: string, run: string) {
  const [d] = await db.select({ name: contacts.name, phone: contacts.phoneE164 }).from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).where(eq(deals.id, f.dealId));
  const n = plan.items.length;
  const missing = f.messageIds ?? plan.items.map((i) => i.m.id);
  const label = (id: string) => { const it = plan.items.find((i) => i.m.id === id); return it ? `${ITEM[it.m.kind] ?? "mensagem"} de ${when(it.m.createdAt)}` : "mensagem"; };
  const what = n === 1 ? "não saiu"
    : missing.length >= n ? `as ${n} mensagens não saíram`
    : `${missing.length} de ${n} não ${missing.length === 1 ? "saiu" : "saíram"} (${missing.map(label).join(", ")})`;
  await db.insert(alerts).values({ dealId: d ? f.dealId : null, userId, audience: "responsavel", type: "encaminhar_falhou", severity: "info",
    message: alertText.forwardFailed(d ? clientLabel(d.name, d.phone) : null, what, f.error), dedupeKey: `encaminhar:${run}:${f.dealId}` }).onConflictDoNothing();
}
