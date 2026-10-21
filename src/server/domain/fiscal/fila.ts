import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db, type Tx } from "../../db";
import { auditLog, comandas, fiscalDocuments, fiscalSequences, type FiscalDocument } from "../../db/schema";
import { UserFacingError } from "../errors";
import type { Actor } from "../agenda/actor";
import { can } from "@/lib/permissions";
import { formatCnpj } from "@/lib/cnpj";
import { isUuid } from "@/lib/uuid";
import type { FiscalEmpresa, FiscalModo } from "@/lib/fiscal-settings";
import type { FiscalCert } from "./certificate";
import { getFiscalRegras, getNfceModo, getNfseModo } from "./config";

/**
 * A fila da nota fiscal, a mesma para a NFS-e (Task 12) e a NFC-e (Task 13). Cada tipo traz só o seu "canal" com o governo (enviar e
 * consultar); as regras que evitam nota em dobro moram aqui, uma vez:
 * - uma comanda tem no máximo uma nota `pendente` ou `autorizada` de cada tipo (índice único + a comanda travada ao enfileirar);
 * - o número sai de `fiscal_sequences` na mesma transação e o XML assinado fica em `request_xml`: reenviar usa o MESMO XML;
 * - cada envio "reserva" a nota (soma 1 em `attempts` e empurra `next_try_at`) antes de falar com o governo, então dois cliques ou o
 *   worker junto não mandam a mesma nota duas vezes;
 * - se a nota já teve um envio (`attempts > 1` depois da reserva), o sistema CONSULTA antes de reenviar: se ela virou nota, fica
 *   autorizada sem reenviar; se a consulta falha, não reenvia;
 * - "Emitir de novo" depois de `erro_envio` (ou de uma recusa que veio depois de um envio incerto) também consulta a anterior antes de
 *   gastar um número novo;
 * - as três portas da comanda (reabrir, cancelar, reabrir para corrigir) conferem as notas de todos os tipos;
 * - Teste e Produção não se misturam: a nota viva, o "devolve a que existe" e as portas olham só o ambiente da chave atual (uma nota de
 *   Teste não segura a comanda com a chave em Produção ou Desligada; uma de Produção segura sempre).
 * Nunca registrar em log o XML (tem CPF) nem as respostas do governo.
 */
export type FiscalKind = "nfse" | "nfce";
export type FiscalEnv = "teste" | "producao";

export const NOTA_AUTORIZADA_NA_COMANDA = "Essa comanda tem nota fiscal autorizada: cancele a nota antes.";
export const NOTA_SENDO_ENVIADA = "A nota fiscal desta comanda ainda está sendo enviada: espere a resposta do governo antes.";
export const NOTA_NAO_CONFERIDA = "Não deu para conferir a nota no governo agora. Tente de novo em alguns minutos.";
/** Nota incerta e sem A1 válido no servidor: a consulta nem sai (I-2); a saída é renovar o certificado ou a Gestão resolver fora do CRM. */
export const CERT_PARA_REABRIR = "Para reabrir, o CRM precisa conferir a nota no governo com o certificado digital A1 válido no servidor. Renove/instale o certificado ou use \"Resolver fora do CRM\" (Gestão).";
const CANCELADA_FORA = "Cancelada fora do CRM (conferido no governo).";
const NAO_SAIU_NO_GOVERNO = "Não saiu no governo (conferido antes de reabrir a comanda).";
const NAO_SAIU_ANTES_DE_EMITIR = "Não saiu no governo (conferido antes de emitir de novo).";
/** Começo do motivo gravado por "Resolver fora do CRM" (a Gestão conferiu no portal). */
export const RESOLVIDA_FORA = "Resolvida fora do CRM:";
const DESCARTADA_ANTES_DO_ENVIO = "Descartada: a comanda foi reaberta antes do envio.";
/** Enquanto um envio está em andamento, ninguém mais pega a nota (o envio leva no máximo 30 s; a folga cobre queda do processo). */
const RESERVA_MS = 5 * 60_000;
const KINDS: FiscalKind[] = ["nfse", "nfce"];

/** O governo já tem a nota? `cancelada`: autorizada e já cancelada fora do CRM (a comanda não pode ficar presa a ela). */
export type Consulta =
  | { kind: "existe"; accessKey: string; responseBody: string; authorizedAt?: Date }
  | { kind: "cancelada"; accessKey: string; responseBody: string }
  | { kind: "nao_existe" }
  | { kind: "falha"; error: string };
export type Envio =
  | { kind: "autorizada"; accessKey: string; responseBody: string; authorizedAt?: Date }
  | { kind: "rejeitada"; reason: string; responseBody: string }
  | { kind: "falha"; error: string }; // rede, timeout, 5xx, governo fora: tentar de novo
/** Como falar com o governo sobre uma nota já gravada (cada tipo monta o seu, no ambiente da própria nota). */
export type Canal = { now: () => Date; consultar(doc: FiscalDocument): Promise<Consulta>; enviar(doc: FiscalDocument): Promise<Envio> };
export type CanalOf = (doc: FiscalDocument) => Promise<Canal>;
/** `cancelada`: a consulta achou a nota já cancelada fora do CRM (não conta como autorizada, recusa nem falha). */
export type Outcome = "autorizada" | "rejeitada" | "falha" | "cancelada" | null;

export const audit = (q: Tx | typeof db, userId: string | null, action: string, comandaId: string, data: Record<string, unknown>, at: Date) =>
  q.insert(auditLog).values({ userId, action, entity: "comanda", entityId: comandaId, data, createdAt: at });

/** As notas da comanda do tipo, da mais nova para a mais velha; com `environment`, só as daquele ambiente. */
export const lastDocsOf = (q: Tx | typeof db, comandaId: string, kind: FiscalKind, environment?: FiscalEnv) => q.select().from(fiscalDocuments)
  .where(and(eq(fiscalDocuments.comandaId, comandaId), eq(fiscalDocuments.kind, kind), environment ? eq(fiscalDocuments.environment, environment) : undefined))
  .orderBy(desc(fiscalDocuments.createdAt), desc(fiscalDocuments.number));

/** Nota de Teste só conta (segura a comanda, é conferida) com a chave em Teste; nota de Produção conta sempre. */
const contaNoModo = (modo: FiscalModo) => (d: FiscalDocument) => d.environment !== "teste" || modo === "teste";
const modoOf = (kind: FiscalKind, q: Tx | typeof db = db) => (kind === "nfse" ? getNfseModo(q) : getNfceModo(q));

/** Próximo número da série, com a linha do contador travada (cria o contador da série na primeira vez). */
export async function nextNumberTx(tx: Tx, kind: FiscalKind, environment: FiscalEnv, series: number): Promise<number> {
  await tx.insert(fiscalSequences).values({ kind, environment, series, nextNumber: 1 }).onConflictDoNothing();
  const where = and(eq(fiscalSequences.kind, kind), eq(fiscalSequences.environment, environment), eq(fiscalSequences.series, series));
  const [seq] = await tx.select().from(fiscalSequences).where(where).for("update");
  await tx.update(fiscalSequences).set({ nextNumber: seq.nextNumber + 1 }).where(where);
  return seq.nextNumber;
}

const cnpjRoot = (c: string) => c.replace(/\D/g, "").slice(0, 8);
/** O A1 tem que ser da Casa (mesma raiz de CNPJ): recusa antes de gastar o número. */
export function assertCertDaCasa(cert: FiscalCert, empresa: FiscalEmpresa) {
  if (cert.cnpj && empresa.cnpj && cnpjRoot(cert.cnpj) !== cnpjRoot(empresa.cnpj))
    throw new UserFacingError(`O certificado digital é de outro CNPJ (${formatCnpj(cert.cnpj)}). Confira o CNPJ da Casa em Configurações › Nota fiscal.`);
}

/** A comanda travada, fechada e com a nota viva do tipo (pendente ou autorizada) NO AMBIENTE da chave atual, se houver. */
export async function lockClosedComandaTx(tx: Tx, comandaId: string, kind: FiscalKind, environment: FiscalEnv) {
  const [c] = isUuid(comandaId) ? await tx.select().from(comandas).where(eq(comandas.id, comandaId)).for("update") : [];
  if (!c) throw new UserFacingError("Comanda não encontrada.");
  if (c.status !== "fechada") throw new UserFacingError("Feche a comanda antes de emitir a nota.");
  const [live] = await tx.select({ id: fiscalDocuments.id }).from(fiscalDocuments)
    .where(and(eq(fiscalDocuments.comandaId, c.id), eq(fiscalDocuments.kind, kind), eq(fiscalDocuments.environment, environment), inArray(fiscalDocuments.status, ["pendente", "autorizada"])));
  return { comanda: c, live: live ?? null };
}

/**
 * Toda escrita de resultado só vale se a nota ainda está na situação em que foi lida (`doc.status`): um resultado atrasado (um envio lento,
 * o worker e um "Emitir de novo" juntos) nunca sobrescreve uma nota que outro caminho já resolveu.
 */
const still = (doc: FiscalDocument) => and(eq(fiscalDocuments.id, doc.id), eq(fiscalDocuments.status, doc.status));

export async function authorizedDoc(doc: FiscalDocument, accessKey: string, responseBody: string, at: Date): Promise<Outcome> {
  const [ok] = await db.update(fiscalDocuments).set({ status: "autorizada", accessKey, responseBody, authorizedAt: at, nextTryAt: null, lastError: null, rejectReason: null })
    .where(still(doc)).returning({ id: fiscalDocuments.id });
  if (!ok) await lateAuthorization(doc, accessKey, at);
  return "autorizada";
}

/**
 * O governo autorizou, mas a nota já tinha sido resolvida por outro caminho (descartada, conferida, resolvida fora do CRM): a escrita não
 * sobrescreve (`still`), e a autorização tardia fica na auditoria (M-4) para alguém conferir. Só a chave e o id: nunca o XML nem o CPF.
 * A mesma autorização vista duas vezes (a nota já está autorizada com a mesma chave) não é aviso.
 */
async function lateAuthorization(doc: FiscalDocument, accessKey: string, at: Date) {
  const [now] = await db.select({ status: fiscalDocuments.status, accessKey: fiscalDocuments.accessKey }).from(fiscalDocuments).where(eq(fiscalDocuments.id, doc.id));
  if (now?.status === "autorizada" && now.accessKey === accessKey) return;
  await audit(db, null, "nota_autorizada_tardia", doc.comandaId, { tipo: doc.kind, nota: doc.number, id: doc.id, chave: accessKey, situacao: now?.status ?? null }, at);
}

/** A nota saiu e já foi cancelada fora do CRM (consulta 101/151/155): fica `cancelada`, sem travar a comanda. */
async function cancelledOutsideDoc(doc: FiscalDocument, accessKey: string, responseBody: string, at: Date): Promise<Outcome> {
  await db.update(fiscalDocuments).set({ status: "cancelada", accessKey, responseBody, cancelledAt: at, cancelReason: CANCELADA_FORA, nextTryAt: null, lastError: null })
    .where(still(doc));
  return "cancelada";
}

/** Falha (rede, timeout, 5xx, acesso recusado): espera min(2^tentativas, esperaMaxMin) minutos; na última tentativa vira erro_envio. */
export async function failedDoc(doc: FiscalDocument, error: string, now: Date): Promise<Outcome> {
  const regras = await getFiscalRegras();
  if (doc.attempts >= regras.tentativasMax) {
    await db.update(fiscalDocuments).set({ status: "erro_envio", lastError: error, nextTryAt: null }).where(still(doc));
  } else {
    const waitMin = Math.min(2 ** doc.attempts, regras.esperaMaxMin);
    await db.update(fiscalDocuments).set({ lastError: error, nextTryAt: new Date(now.getTime() + waitMin * 60_000) }).where(still(doc));
  }
  return "falha";
}

/**
 * Uma tentativa de envio da nota `pendente` que já está na hora. Reserva primeiro (ninguém mais pega), consulta se já houve envio antes, e só
 * então envia. null = não estava na hora, já foi pega por outro envio ou não está mais pendente.
 */
export async function attemptOnce(docId: string, now: Date, canalOf: CanalOf): Promise<Outcome> {
  const [doc] = await db.update(fiscalDocuments)
    .set({ attempts: sql`${fiscalDocuments.attempts} + 1`, nextTryAt: new Date(now.getTime() + RESERVA_MS) })
    .where(and(eq(fiscalDocuments.id, docId), eq(fiscalDocuments.status, "pendente"), or(isNull(fiscalDocuments.nextTryAt), lte(fiscalDocuments.nextTryAt, now))))
    .returning();
  if (!doc) return null;
  let canal: Canal;
  try { canal = await canalOf(doc); }
  catch (e) { if (e instanceof UserFacingError) return failedDoc(doc, e.message, now); throw e; }

  if (doc.attempts > 1) {
    // Já houve envio: pergunta ao governo se a nota saiu antes de mandar de novo (Review Focus 2).
    const q = await canal.consultar(doc);
    if (q.kind === "existe") return authorizedDoc(doc, q.accessKey, q.responseBody, q.authorizedAt ?? now);
    if (q.kind === "cancelada") return cancelledOutsideDoc(doc, q.accessKey, q.responseBody, now);
    if (q.kind === "falha") return failedDoc(doc, `Não deu para confirmar com o governo se a nota já saiu: ${q.error}`, now);
  }
  const r = await canal.enviar(doc);
  if (r.kind === "autorizada") return authorizedDoc(doc, r.accessKey, r.responseBody, r.authorizedAt ?? now);
  if (r.kind === "rejeitada") {
    await db.update(fiscalDocuments).set({ status: "rejeitada", rejectReason: r.reason, responseBody: r.responseBody, nextTryAt: null, lastError: null })
      .where(still(doc));
    return "rejeitada";
  }
  return failedDoc(doc, r.error, now);
}

const statusOf = async (id: string) => (await db.select({ status: fiscalDocuments.status }).from(fiscalDocuments).where(eq(fiscalDocuments.id, id)))[0]?.status ?? "pendente";

/**
 * "Emitir nota" e "Emitir de novo" de qualquer tipo (pede `nota.emitir`): enfileira (ou devolve a nota viva da comanda) e faz uma tentativa
 * já. Depois de `erro_envio`, confere no governo se a nota anterior saiu antes de gastar um número novo.
 */
export async function emitirNotaDaComanda(o: {
  kind: FiscalKind; comandaId: string; actor: Actor; now: Date; modo: FiscalModo; desligada: string; semNada: string;
  queue: (tx: Tx) => Promise<{ id: string } | null>; canalOf: CanalOf;
}): Promise<{ id: string; status: string }> {
  if (!can(o.actor.perms, "nota.emitir")) throw new UserFacingError("Você não tem permissão para emitir nota fiscal.");
  if (o.modo === "desligada") throw new UserFacingError(o.desligada);
  const [c] = isUuid(o.comandaId) ? await db.select({ status: comandas.status }).from(comandas).where(eq(comandas.id, o.comandaId)) : [];
  if (!c) throw new UserFacingError("Comanda não encontrada.");
  if (c.status !== "fechada") throw new UserFacingError("Feche a comanda antes de emitir a nota.");
  const [last] = await lastDocsOf(db, o.comandaId, o.kind, o.modo).limit(1);
  // Incerta: erro_envio, ou recusada depois de um envio incerto (a recusa pode ser o governo dizendo que já tinha recebido; I-1).
  // A recusa já conferida (aqui, nas portas ou pela Gestão fora do CRM) não é consultada de novo.
  const conferida = (r: string | null) => r === NAO_SAIU_NO_GOVERNO || r === NAO_SAIU_ANTES_DE_EMITIR || r === DESCARTADA_ANTES_DO_ENVIO || !!r?.startsWith(RESOLVIDA_FORA);
  if (last && (last.status === "erro_envio" || (last.status === "rejeitada" && last.attempts > 1 && !conferida(last.rejectReason)))) {
    const q = await (await o.canalOf(last)).consultar(last);
    if (q.kind === "falha") throw new UserFacingError(`Não deu para confirmar com o governo se a nota anterior saiu. Tente de novo em alguns minutos. (${q.error})`);
    if (q.kind === "existe") {
      await authorizedDoc(last, q.accessKey, q.responseBody, q.authorizedAt ?? o.now);
      await audit(db, o.actor.id, "nota_emitida", o.comandaId, { tipo: o.kind, nota: last.number, status: "autorizada", conferida: true }, o.now);
      return { id: last.id, status: "autorizada" };
    }
    // Saiu e foi cancelada fora do CRM: registra e segue para uma nota nova.
    if (q.kind === "cancelada") await cancelledOutsideDoc(last, q.accessKey, q.responseBody, o.now);
    // Não saiu: fica registrado que foi conferida antes de gastar o número novo.
    if (q.kind === "nao_existe") {
      const [n] = await db.update(fiscalDocuments).set({ status: "rejeitada", rejectReason: NAO_SAIU_ANTES_DE_EMITIR, nextTryAt: null }).where(still(last)).returning({ id: fiscalDocuments.id });
      if (n) await audit(db, o.actor.id, "nota_conferida", o.comandaId,
        { tipo: o.kind, nota: last.number, de: last.status, para: "rejeitada", motivoAntes: last.rejectReason ?? last.lastError ?? null, motivo: NAO_SAIU_ANTES_DE_EMITIR }, o.now);
    }
  }
  const q = await db.transaction((tx) => o.queue(tx));
  if (!q) throw new UserFacingError(o.semNada);
  // Nota que já existia (autorizada, ou pendente com envio em andamento ou esperando a próxima tentativa): só devolve a situação.
  const tried = await attemptOnce(q.id, o.now, o.canalOf);
  const status = await statusOf(q.id);
  if (tried) {
    const [doc] = await db.select({ number: fiscalDocuments.number }).from(fiscalDocuments).where(eq(fiscalDocuments.id, q.id));
    await audit(db, o.actor.id, "nota_emitida", o.comandaId, { tipo: o.kind, nota: doc?.number ?? null, status }, o.now);
  }
  return { id: q.id, status };
}

/**
 * O worker (fila `nota-fiscal`, todo minuto): as pendentes do tipo na hora, uma tentativa cada. O relógio é lido de novo a cada nota: com
 * um "agora" único, a reserva da 6ª nota em diante (depois de 5 envios de até 30 s) já nasceria vencida e outro envio pegaria a mesma nota.
 */
export async function processPendingKind(kind: FiscalKind, clock: () => Date, canalOf: CanalOf, limit: number): Promise<{ autorizadas: number; rejeitadas: number; falhas: number }> {
  const out = { autorizadas: 0, rejeitadas: 0, falhas: 0 };
  const now = clock();
  const due = await db.select({ id: fiscalDocuments.id }).from(fiscalDocuments)
    .where(and(eq(fiscalDocuments.kind, kind), eq(fiscalDocuments.status, "pendente"), or(isNull(fiscalDocuments.nextTryAt), lte(fiscalDocuments.nextTryAt, now))))
    .orderBy(asc(fiscalDocuments.createdAt)).limit(limit);
  for (const { id } of due) {
    let r: Outcome;
    // Erro inesperado numa nota não para a fila. Nunca registrar a mensagem: um erro do banco traz os parâmetros (XML com CPF).
    try { r = await attemptOnce(id, clock(), canalOf); }
    catch (e) { console.error("[nota fiscal] erro ao enviar a nota", id, e instanceof Error ? e.name : "erro"); r = "falha"; }
    if (r === "autorizada") out.autorizadas++;
    else if (r === "rejeitada") out.rejeitadas++;
    else if (r === "falha") out.falhas++;
  }
  return out;
}

/**
 * Antes de reabrir ou cancelar a comanda (fora da transação, porque pode falar com o governo): a última nota do tipo está incerta —
 * `erro_envio`, ou `pendente` já enviada com a chave desligada (o worker parou) — então consulta no ambiente gravado na nota.
 * Existe: a nota vira autorizada e a comanda não reabre. Não existe: a nota fica rejeitada ("não saiu") e libera. Falha: recusa.
 * Sem o A1 no servidor, ou com ele vencido, a consulta não sai: recusa com `CERT_PARA_REABRIR` (a saída é "Resolver fora do CRM").
 */
export async function settleBeforeReopen(
  kind: FiscalKind, comandaId: string, modo: () => Promise<FiscalModo>, canalOf: CanalOf, certOf: () => Promise<FiscalCert | null>, actorId: string | null = null,
): Promise<void> {
  if (!isUuid(comandaId)) return;
  const m = await modo();
  const [last] = (await lastDocsOf(db, comandaId, kind)).filter(contaNoModo(m));
  if (!last) return;
  const uncertain = last.status === "erro_envio" || (last.status === "pendente" && last.attempts > 0 && m === "desligada");
  if (!uncertain) return;
  const cert = await certOf();
  if (!cert) throw new UserFacingError(CERT_PARA_REABRIR);
  const canal = await canalOf(last);
  const now = canal.now();
  if (cert.notAfter.getTime() <= now.getTime()) throw new UserFacingError(CERT_PARA_REABRIR);
  const q = await canal.consultar(last);
  if (q.kind === "falha") throw new UserFacingError(NOTA_NAO_CONFERIDA);
  // Só mexe se a nota ainda está como foi lida (o worker pode ter andado no meio).
  const same = and(eq(fiscalDocuments.id, last.id), eq(fiscalDocuments.status, last.status), eq(fiscalDocuments.attempts, last.attempts));
  // Cada conferência que muda a nota fica na auditoria com de/para (M-4).
  const conferida = async (para: string, extra: Record<string, unknown>) =>
    audit(db, actorId, "nota_conferida", comandaId, { tipo: kind, nota: last.number, de: last.status, para, ...extra }, now);
  if (q.kind === "existe") {
    const [w] = await db.update(fiscalDocuments).set({ status: "autorizada", accessKey: q.accessKey, responseBody: q.responseBody, authorizedAt: q.authorizedAt ?? now, nextTryAt: null, lastError: null })
      .where(same).returning({ id: fiscalDocuments.id });
    if (w) await conferida("autorizada", { chave: q.accessKey });
    throw new UserFacingError(NOTA_AUTORIZADA_NA_COMANDA);
  }
  if (q.kind === "cancelada") {
    const [w] = await db.update(fiscalDocuments).set({ status: "cancelada", accessKey: q.accessKey, responseBody: q.responseBody, cancelledAt: now, cancelReason: CANCELADA_FORA, nextTryAt: null, lastError: null })
      .where(same).returning({ id: fiscalDocuments.id });
    if (w) await conferida("cancelada", { chave: q.accessKey, motivo: CANCELADA_FORA });
    return;
  }
  const [w] = await db.update(fiscalDocuments).set({ status: "rejeitada", rejectReason: NAO_SAIU_NO_GOVERNO, nextTryAt: null }).where(same).returning({ id: fiscalDocuments.id });
  if (w) await conferida("rejeitada", { motivo: NAO_SAIU_NO_GOVERNO });
}

/**
 * Dentro da transação das três portas (Review Focus 1), com as notas da comanda travadas, para cada tipo: autorizada recusa; pendente
 * nunca enviada (attempts = 0) é descartada; pendente já enviada recusa (o worker resolve); erro_envio que não foi conferido recusa.
 */
export async function assertNoAuthorizedNoteTx(tx: Tx, comandaId: string, actorId: string | null = null, now = new Date()): Promise<void> {
  for (const kind of KINDS) {
    const docs = (await lastDocsOf(tx, comandaId, kind).for("update")).filter(contaNoModo(await modoOf(kind, tx)));
    if (docs.some((d) => d.status === "autorizada")) throw new UserFacingError(NOTA_AUTORIZADA_NA_COMANDA);
    const last = docs[0];
    if (!last) continue;
    if (last.status === "pendente" && last.attempts === 0) {
      await tx.update(fiscalDocuments).set({ status: "rejeitada", rejectReason: DESCARTADA_ANTES_DO_ENVIO, nextTryAt: null }).where(eq(fiscalDocuments.id, last.id));
      await audit(tx, actorId, "nota_descartada", comandaId, { tipo: kind, nota: last.number, de: "pendente", para: "rejeitada", motivo: DESCARTADA_ANTES_DO_ENVIO }, now);
      continue;
    }
    if (last.status === "pendente") throw new UserFacingError(NOTA_SENDO_ENVIADA);
    if (last.status === "erro_envio") throw new UserFacingError(NOTA_NAO_CONFERIDA);
  }
}
