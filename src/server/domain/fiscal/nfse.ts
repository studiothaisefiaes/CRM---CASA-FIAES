import { and, eq } from "drizzle-orm";
import { db, type Tx } from "../../db";
import { fiscalDocuments, type FiscalDocument } from "../../db/schema";
import { UserFacingError } from "../errors";
import type { Actor } from "../agenda/actor";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/uuid";
import { loadFiscalCert, loadFiscalCertOrNull, type FiscalCert } from "./certificate";
import { getFiscalEmpresa, getFiscalRegras, getNfseModo } from "./config";
import { buildCancelEventXml, buildDpsXml } from "./dps-xml";
import { loadNfseDraft } from "./draft";
import {
  assertCertDaCasa, audit, emitirNotaDaComanda, lockClosedComandaTx, nextNumberTx, processPendingKind, settleBeforeReopen, type Canal, type FiscalEnv,
} from "./fila";
import { createSefinClient } from "./sefin-client";
import { signXml } from "./sign";

/**
 * Emissão da NFS-e pela comanda (Fase D, Task 12): fila sem duplicar, tentativas com espera e cancelamento. As regras da fila (reserva,
 * consulta antes de reenviar, as três portas da comanda) estão em `fila.ts`, as mesmas da NFC-e; aqui fica só o que é da NFS-e: a DPS,
 * a Sefin Nacional (consulta pelo Id da DPS) e o evento e101101.
 * Nunca registrar em log o XML (tem CPF) nem as respostas do governo.
 */
export type NfseDeps = { client: ReturnType<typeof createSefinClient>; cert: FiscalCert; now: () => Date };
type Env = FiscalEnv;

export const NFSE_DESLIGADA = "A nota fiscal está desligada em Configurações › Nota fiscal.";
export { NOTA_AUTORIZADA_NA_COMANDA, NOTA_NAO_CONFERIDA, NOTA_SENDO_ENVIADA } from "./fila";
const SEM_CERTIFICADO = "Instale o certificado digital A1 no servidor antes de emitir a nota.";
/** cMotivo do cancelamento: 9 = Outros, com o motivo escrito (XSD, 18/10/2026). */
const MOTIVO_CANCELAMENTO_OUTROS = "9";

/** Deps de verdade: o A1 do .env e a Sefin do ambiente da nota. Nos testes, o transporte real é bloqueado (httpsTransport). */
export async function realNfseDeps(environment: Env): Promise<NfseDeps> {
  const cert = await loadFiscalCert();
  if (!cert) throw new UserFacingError(SEM_CERTIFICADO);
  return { cert, client: createSefinClient({ environment, cert }), now: () => new Date() };
}

/** O canal da NFS-e para a fila: consulta pelo Id da DPS e envia a DPS assinada guardada. */
function canalNfse(d: NfseDeps): Canal {
  return {
    now: d.now,
    async consultar(doc: FiscalDocument) {
      const q = await d.client.consultarDps(doc.localId);
      return q.kind === "existe" ? { kind: "existe", accessKey: q.accessKey, responseBody: JSON.stringify({ chaveAcesso: q.accessKey }) } : q;
    },
    async enviar(doc: FiscalDocument) {
      const r = await d.client.emitir(doc.requestXml ?? "");
      if (r.kind === "autorizada") return { kind: "autorizada", accessKey: r.accessKey, responseBody: r.nfseXml || JSON.stringify(r.raw) };
      if (r.kind === "rejeitada") return { kind: "rejeitada", reason: r.reasons.join(" · "), responseBody: JSON.stringify(r.raw) };
      return r;
    },
  };
}
const canalOf = (deps?: NfseDeps) => async (doc: FiscalDocument) => canalNfse(deps ?? (await realNfseDeps(doc.environment as Env)));

/** Antes de reabrir ou cancelar a comanda: a NFS-e incerta é conferida na Sefin (ver `settleBeforeReopen`). */
export const settleNfseBeforeReopen = (comandaId: string, deps?: NfseDeps, actorId: string | null = null) =>
  settleBeforeReopen("nfse", comandaId, () => getNfseModo(), canalOf(deps), deps ? async () => deps.cert : loadFiscalCertOrNull, actorId);

/**
 * Reserva o número e grava a nota `pendente` com a DPS assinada (sem falar com o governo). Já existe uma pendente ou autorizada: devolve
 * essa. `quietIfNoService`: no fechamento da comanda, comanda sem serviço não tem nota (null em vez de erro).
 */
export async function queueNfseTx(tx: Tx, comandaId: string, actorId: string, now: Date, opts: { cert?: FiscalCert | null; quietIfNoService?: boolean } = {}): Promise<{ id: string } | null> {
  const modo = await getNfseModo(tx);
  if (modo === "desligada") throw new UserFacingError(NFSE_DESLIGADA);
  const { comanda: c, live } = await lockClosedComandaTx(tx, comandaId, "nfse", modo);
  if (live) return { id: live.id };
  const draft = await loadNfseDraft(c.id, tx);
  if (!draft) {
    if (opts.quietIfNoService) return null;
    throw new UserFacingError("Essa comanda não tem serviço para nota.");
  }
  // A cota-parte da parceira sem CNPJ não entra no texto: a nota sairia como se o serviço fosse todo do salão.
  if (draft.parceirasSemCnpj.length) throw new UserFacingError(`A parceira ${draft.parceirasSemCnpj[0]} está sem CNPJ: cadastre antes de emitir a nota.`);
  const [empresa, regras] = await Promise.all([getFiscalEmpresa(tx), getFiscalRegras(tx)]);
  // `cert: null` = já procurado e não há (o fechamento lê o .pfx antes da transação).
  const cert = opts.cert !== undefined ? opts.cert : await loadFiscalCert();
  if (!cert) throw new UserFacingError(SEM_CERTIFICADO);
  assertCertDaCasa(cert, empresa);
  // O número entra no XML: se a DPS for recusada aqui (dado faltando na Casa), a transação volta e o contador também.
  const number = await nextNumberTx(tx, "nfse", modo, empresa.serieDps);
  const { xml, id } = buildDpsXml({ draft, empresa, regras, environment: modo, series: empresa.serieDps, number, emittedAt: now });
  const signed = signXml(xml, { elementLocalName: "infDPS", id, cert, algorithm: regras.assinaturaNfse });
  const [doc] = await tx.insert(fiscalDocuments).values({
    comandaId: c.id, kind: "nfse", environment: modo, series: empresa.serieDps, number, localId: id, status: "pendente",
    amountCents: draft.totalCents, requestXml: signed, createdBy: actorId, createdAt: now,
  }).returning({ id: fiscalDocuments.id });
  await audit(tx, actorId, "nota_enfileirada", c.id, { numero: c.number, nota: number, serie: empresa.serieDps, ambiente: modo, valor: draft.totalCents }, now);
  return { id: doc.id };
}

/**
 * "Emitir nota" e "Emitir de novo" (pede `nota.emitir`): enfileira (ou devolve a nota viva da comanda) e faz uma tentativa já.
 * Depois de `erro_envio`, confere no governo se a nota anterior saiu antes de gastar um número novo.
 */
export async function emitNfse(comandaId: string, actor: Actor, deps?: NfseDeps): Promise<{ id: string; status: string }> {
  if (!can(actor.perms, "nota.emitir")) throw new UserFacingError("Você não tem permissão para emitir nota fiscal.");
  const now = deps?.now() ?? new Date();
  return emitirNotaDaComanda({
    kind: "nfse", comandaId, actor, now, modo: await getNfseModo(), desligada: NFSE_DESLIGADA, semNada: "Essa comanda não tem serviço para nota.",
    queue: (tx) => queueNfseTx(tx, comandaId, actor.id, now, { cert: deps?.cert }), canalOf: canalOf(deps),
  });
}

/** O worker (fila `nota-fiscal`, todo minuto): as pendentes na hora, uma tentativa cada. Com a chave desligada, não envia nada. */
export async function processPendingNfse(deps?: NfseDeps, limit = 10): Promise<{ autorizadas: number; rejeitadas: number; falhas: number }> {
  if ((await getNfseModo()) === "desligada") return { autorizadas: 0, rejeitadas: 0, falhas: 0 };
  return processPendingKind("nfse", deps?.now ?? (() => new Date()), canalOf(deps), limit);
}

/** "Cancelar nota" (pede `nota.cancelar`): evento e101101 assinado; com o sim do governo, a nota vira `cancelada` e a comanda volta a reabrir. */
export async function cancelNfse(docId: string, i: { reason: string }, actor: Actor, deps?: NfseDeps): Promise<void> {
  if (!can(actor.perms, "nota.cancelar")) throw new UserFacingError("Você não tem permissão para cancelar nota fiscal.");
  const reason = (i.reason ?? "").trim().replace(/\s+/g, " ");
  if (reason.length < 15) throw new UserFacingError("Escreva o motivo do cancelamento (pelo menos 15 letras).");
  if (reason.length > 255) throw new UserFacingError("O motivo do cancelamento passa de 255 caracteres.");
  if (!isUuid(docId)) throw new UserFacingError("Nota fiscal não encontrada.");
  const [empresa, regras] = await Promise.all([getFiscalEmpresa(), getFiscalRegras()]);
  // A linha fica travada durante a conversa com o governo (no máximo 30 s): um duplo clique espera e recebe "já foi cancelada".
  // Vale com a chave desligada: o ambiente é o da própria nota.
  await db.transaction(async (tx) => {
    const [doc] = await tx.select().from(fiscalDocuments).where(and(eq(fiscalDocuments.id, docId), eq(fiscalDocuments.kind, "nfse"))).for("update");
    if (!doc) throw new UserFacingError("Nota fiscal não encontrada.");
    if (doc.status === "cancelada") throw new UserFacingError("Essa nota já foi cancelada.");
    if (doc.status !== "autorizada" || !doc.accessKey) throw new UserFacingError("Só nota autorizada pode ser cancelada.");
    const d = deps ?? (await realNfseDeps(doc.environment as Env));
    const now = d.now();
    const ev = buildCancelEventXml({ accessKey: doc.accessKey, cnpj: empresa.cnpj ?? "", environment: doc.environment as Env, reason, code: MOTIVO_CANCELAMENTO_OUTROS, emittedAt: now });
    const signed = signXml(ev.xml, { elementLocalName: "infPedReg", id: ev.id, cert: d.cert, algorithm: regras.assinaturaNfse });
    const r = await d.client.cancelar(doc.accessKey, signed);
    if (!r.ok) throw new UserFacingError(`O governo não cancelou a nota: ${r.reason}`);
    await tx.update(fiscalDocuments).set({ status: "cancelada", cancelledAt: now, cancelledBy: actor.id, cancelReason: reason }).where(eq(fiscalDocuments.id, doc.id));
    await audit(tx, actor.id, "nota_cancelada", doc.comandaId, { tipo: "nfse", nota: doc.number, chave: doc.accessKey, de: "autorizada", para: "cancelada", motivo: reason }, now);
  });
}
