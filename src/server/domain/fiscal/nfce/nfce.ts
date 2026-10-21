import { and, asc, eq, isNull } from "drizzle-orm";
import { db, type Tx } from "../../../db";
import { comandaItems, comandaPayments, fiscalDocuments, products, type FiscalDocument } from "../../../db/schema";
import { UserFacingError } from "../../errors";
import type { Actor } from "../../agenda/actor";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/uuid";
import type { PayMethod } from "@/lib/comanda-math";
import { loadFiscalCert, loadFiscalCertOrNull, type FiscalCert } from "../certificate";
import { getFiscalEmpresa, getFiscalRegras, getNfceModo } from "../config";
import {
  assertCertDaCasa, audit, emitirNotaDaComanda, lockClosedComandaTx, nextNumberTx, processPendingKind, settleBeforeReopen, type Canal, type Consulta, type FiscalEnv,
} from "../fila";
import { signXml } from "../sign";
import { inserirSupl, montarQrCode } from "./qrcode";
import { createSvrsClient, NFCE_CONSULTA_BA, TP_AMB_NFCE, type ConsultaResult } from "./soap";
import { buildNfceCancelEventXml, buildNfceXml, nfeProcOf, prorate, type NfceItem, type NfcePagamento } from "./xml";

export { prorate, tPagOf } from "./xml";

/**
 * NFC-e de produto pela comanda (Fase D, Task 13; porte do Norte Vendas). A mesma fila da NFS-e (`fila.ts`): reserva antes do envio,
 * consulta pela chave (NFeConsultaProtocolo4) antes de reenviar, as três portas da comanda conferem a NFC-e incerta. Só os itens `produto`
 * com valor líquido; o `<pag>` é o rateio das formas da comanda (sem cortesia e sem o troco) pelo valor dos produtos.
 * Liga/desliga: `nfce_modo` (Configurações › Nota fiscal). CSC e ID do CSC: só no .env do servidor (NFCE_CSC, NFCE_CSC_ID).
 * Contingência offline fica fora desta fase: sem a SEFAZ, a nota fica na fila; uma NFC-e com mais de alguns minutos entre a emissão e a
 * recepção pode voltar recusada por atraso (cStat 704) e aí "Emitir NFC-e de novo" gasta outro número.
 * Nunca registrar em log o XML (pode ter CPF) nem as respostas da SEFAZ.
 */
export type NfceDeps = { client: ReturnType<typeof createSvrsClient>; cert: FiscalCert; now: () => Date };
type Env = FiscalEnv;

export const NFCE_DESLIGADA = "A NFC-e está desligada em Configurações › Nota fiscal.";
const SEM_CERTIFICADO = "Instale o certificado digital A1 no servidor antes de emitir a nota.";
const SEM_CSC = "Coloque o CSC da SEFAZ-BA no servidor (NFCE_CSC e NFCE_CSC_ID) antes de emitir a NFC-e.";
const SEM_PRODUTO = "Essa comanda não tem produto para nota.";
/**
 * Produto 100% em cortesia: o valor dele na nota (`net_cents`) é zero. O Norte Vendas emite essa venda com tPag 90 e o valor cheio do
 * produto, mas aqui a base da nota é o líquido (sem a cortesia, a mesma regra da comissão e do faturamento): não há venda a declarar.
 */
const SO_CORTESIA = "Produto dado como cortesia não sai na NFC-e: emita a nota só se houver produto pago.";

/** Deps de verdade: o A1 do .env e a SVRS do ambiente da nota. Nos testes, o transporte real é bloqueado (svrsHttpsTransport). */
export async function realNfceDeps(environment: Env): Promise<NfceDeps> {
  const cert = await loadFiscalCert();
  if (!cert) throw new UserFacingError(SEM_CERTIFICADO);
  return { cert, client: createSvrsClient({ environment, cert }), now: () => new Date() };
}

/** CSC e ID do CSC do .env (o ID: até 6 números). Nunca do banco nem do repositório. */
function cscFromEnv(env: Record<string, string | undefined> = process.env): { id: string; csc: string } {
  const csc = env.NFCE_CSC?.trim(), id = env.NFCE_CSC_ID?.trim();
  if (!csc || !id || !/^[0-9]{1,6}$/.test(id)) throw new UserFacingError(SEM_CSC);
  return { id, csc };
}

const chaveOf = (doc: FiscalDocument) => doc.localId.replace(/^NFe/, "");
const dateOf = (s: string | null) => { const t = s ? Date.parse(s) : NaN; return Number.isFinite(t) ? new Date(t) : undefined; };
const nProtOf = (xml: string | null) => xml?.match(/<protNFe[\s\S]*?<nProt>([0-9]{15})<\/nProt>/)?.[1] ?? null;

/** O canal da NFC-e para a fila: consulta pela chave e envia a NFC-e assinada guardada. O prazo de cancelamento conta do dhRecbto. */
function canalNfce(d: NfceDeps): Canal {
  const consultar = async (doc: FiscalDocument): Promise<Consulta> => {
    const q: ConsultaResult = await d.client.consultar(chaveOf(doc));
    if (q.kind === "cancelada") return { kind: "cancelada", accessKey: chaveOf(doc), responseBody: q.body };
    if (q.kind !== "existe") return q;
    return { kind: "existe", accessKey: chaveOf(doc), responseBody: q.protNFe ? nfeProcOf(doc.requestXml ?? "", q.protNFe) : `<retConsSitNFe><cStat>${q.cStat}</cStat></retConsSitNFe>`, authorizedAt: dateOf(q.dhRecbto) };
  };
  return {
    now: d.now,
    consultar,
    async enviar(doc: FiscalDocument) {
      const r = await d.client.autorizar(doc.requestXml ?? "", String(doc.number));
      if (r.kind === "autorizada") {
        // O protocolo tem que ser desta chave: outro chNFe é resposta trocada, não autorização.
        if (!r.protNFe.includes(`<chNFe>${chaveOf(doc)}</chNFe>`)) return { kind: "falha", error: "A SEFAZ respondeu com o protocolo de outra chave." };
        return { kind: "autorizada", accessKey: chaveOf(doc), responseBody: nfeProcOf(doc.requestXml ?? "", r.protNFe), authorizedAt: dateOf(r.dhRecbto) };
      }
      if (r.kind === "rejeitada") return { kind: "rejeitada", reason: r.reason, responseBody: r.raw };
      return r;
    },
  };
}
const canalOf = (deps?: NfceDeps) => async (doc: FiscalDocument) => canalNfce(deps ?? (await realNfceDeps(doc.environment as Env)));

/** Antes de reabrir ou cancelar a comanda: a NFC-e incerta é conferida pela chave (ver `settleBeforeReopen`). */
export const settleNfceBeforeReopen = (comandaId: string, deps?: NfceDeps, actorId: string | null = null) =>
  settleBeforeReopen("nfce", comandaId, () => getNfceModo(), canalOf(deps), deps ? async () => deps.cert : loadFiscalCertOrNull, actorId);

/** Os produtos da comanda que vão na nota (valor líquido > 0) e as formas de pagamento rateadas pelo valor deles. */
async function loadNfceLines(tx: Tx, comandaId: string): Promise<{ itens: NfceItem[]; pagamentos: NfcePagamento[]; soCortesia: boolean }> {
  const rows = await tx.select({ i: comandaItems, p: products }).from(comandaItems).leftJoin(products, eq(products.id, comandaItems.productId))
    .where(and(eq(comandaItems.comandaId, comandaId), isNull(comandaItems.cancelledAt), eq(comandaItems.kind, "produto")))
    .orderBy(asc(comandaItems.createdAt), asc(comandaItems.id));
  const itens: NfceItem[] = [];
  for (const { i, p } of rows) {
    const netCents = i.netCents ?? 0;
    if (netCents <= 0) continue;
    const name = p?.name ?? i.label;
    // Produto sem cadastro (texto livre, lançado com Produtos e estoque desligado) também não tem NCM.
    if (!p?.ncm) throw new UserFacingError(`Produto ${name} sem NCM: complete em Serviços e pacotes › Produtos.`);
    itens.push({ productId: p.id, name, ncm: p.ncm, cfop: p.cfop, csosn: p.csosn, unit: p.unit, barcode: p.barcode, qty: Number(i.qty) || 1, netCents });
  }
  const total = itens.reduce((a, x) => a + x.netCents, 0);
  const all = await tx.select().from(comandaPayments).where(and(eq(comandaPayments.comandaId, comandaId), isNull(comandaPayments.cancelledAt))).orderBy(asc(comandaPayments.createdAt));
  // Tem produto, nenhum com valor, e a comanda teve cortesia: o produto foi dado.
  const soCortesia = rows.length > 0 && itens.length === 0 && all.some((x) => x.method === "cortesia");
  // Formas da comanda sem cortesia (não é pagamento) e sem o troco devolvido; rateadas pelo valor dos produtos (o resto vai na NFS-e).
  const pays = all.filter((x) => x.method !== "cortesia" && x.valueCents - x.changeCents > 0);
  const shares = prorate(total, pays.map((x) => ({ key: x.id, cents: x.valueCents - x.changeCents })));
  const pagamentos = pays.map((x) => ({ method: x.method as PayMethod, cents: shares.get(x.id) ?? 0, brand: x.brand })).filter((x) => x.cents > 0);
  return { itens, pagamentos, soCortesia };
}

/**
 * Reserva o número e grava a NFC-e `pendente` assinada, com o QR Code (sem falar com a SEFAZ). Já existe uma pendente ou autorizada:
 * devolve essa. `quietIfNoProduct`: no fechamento da comanda, comanda sem produto não tem NFC-e (null em vez de erro).
 */
export async function queueNfceTx(tx: Tx, comandaId: string, actorId: string, now: Date, opts: { cert?: FiscalCert | null; quietIfNoProduct?: boolean } = {}): Promise<{ id: string } | null> {
  const modo = await getNfceModo(tx);
  if (modo === "desligada") throw new UserFacingError(NFCE_DESLIGADA);
  const { comanda: c, live } = await lockClosedComandaTx(tx, comandaId, "nfce", modo);
  if (live) return { id: live.id };
  const { itens, pagamentos, soCortesia } = await loadNfceLines(tx, c.id);
  if (!itens.length) {
    if (opts.quietIfNoProduct) return null;
    throw new UserFacingError(soCortesia ? SO_CORTESIA : SEM_PRODUTO);
  }
  const empresa = await getFiscalEmpresa(tx);
  const csc = cscFromEnv();
  const cert = opts.cert !== undefined ? opts.cert : await loadFiscalCert();
  if (!cert) throw new UserFacingError(SEM_CERTIFICADO);
  assertCertDaCasa(cert, empresa);
  // O número entra na chave: se o XML for recusado aqui (dado faltando na Casa ou no produto), a transação volta e o contador também.
  const number = await nextNumberTx(tx, "nfce", modo, empresa.serieNfce);
  const { xml, id, chave, totalCents } = buildNfceXml({ empresa, environment: modo, series: empresa.serieNfce, number, emittedAt: now, itens, pagamentos, consumidor: { cpf: c.cpf, nome: c.clientName } });
  // A NFC-e assina com SHA-1 (o leiaute 4.00 só aceita RSA-SHA1), Signature logo depois de infNFe; o QR Code entra depois de assinar.
  const signed = signXml(xml, { elementLocalName: "infNFe", id, cert, algorithm: "sha1" });
  const { supl } = montarQrCode({ chave, tpAmb: TP_AMB_NFCE[modo], idCsc: csc.id, csc: csc.csc, ...NFCE_CONSULTA_BA[modo] });
  const [doc] = await tx.insert(fiscalDocuments).values({
    comandaId: c.id, kind: "nfce", environment: modo, series: empresa.serieNfce, number, localId: id, status: "pendente",
    amountCents: totalCents, requestXml: inserirSupl(signed, supl), createdBy: actorId, createdAt: now,
  }).returning({ id: fiscalDocuments.id });
  await audit(tx, actorId, "nota_enfileirada", c.id, { tipo: "nfce", numero: c.number, nota: number, serie: empresa.serieNfce, ambiente: modo, valor: totalCents }, now);
  return { id: doc.id };
}

/** "Emitir NFC-e" e "Emitir NFC-e de novo" (pede `nota.emitir`), com a mesma fila da NFS-e. */
export async function emitNfce(comandaId: string, actor: Actor, deps?: NfceDeps): Promise<{ id: string; status: string }> {
  if (!can(actor.perms, "nota.emitir")) throw new UserFacingError("Você não tem permissão para emitir nota fiscal.");
  const now = deps?.now() ?? new Date();
  return emitirNotaDaComanda({
    kind: "nfce", comandaId, actor, now, modo: await getNfceModo(), desligada: NFCE_DESLIGADA, semNada: SEM_PRODUTO,
    queue: (tx) => queueNfceTx(tx, comandaId, actor.id, now, { cert: deps?.cert }), canalOf: canalOf(deps),
  });
}

/** O worker (a mesma fila `nota-fiscal`): as NFC-e pendentes na hora. Com a NFC-e desligada, não envia nada. */
export async function processPendingNfce(deps?: NfceDeps, limit = 10): Promise<{ autorizadas: number; rejeitadas: number; falhas: number }> {
  if ((await getNfceModo()) === "desligada") return { autorizadas: 0, rejeitadas: 0, falhas: 0 };
  return processPendingKind("nfce", deps?.now ?? (() => new Date()), canalOf(deps), limit);
}

/**
 * "Cancelar NFC-e" (pede `nota.cancelar`): evento 110111 assinado (SHA-1) com o protocolo da autorização, só até
 * `fiscal_regras.nfceCancelarAteMin` minutos depois da autorização (RICMS-BA art. 107-H: 30 min). Depois do prazo, a SEFAZ devolve
 * cStat 501 e a saída é uma nota de devolução (com o contador): o CRM recusa antes, sem falar com a SEFAZ.
 */
export async function cancelNfce(docId: string, i: { reason: string }, actor: Actor, deps?: NfceDeps): Promise<void> {
  if (!can(actor.perms, "nota.cancelar")) throw new UserFacingError("Você não tem permissão para cancelar nota fiscal.");
  const reason = (i.reason ?? "").trim().replace(/\s+/g, " ");
  if (reason.length < 15) throw new UserFacingError("Escreva o motivo do cancelamento (pelo menos 15 letras).");
  if (reason.length > 255) throw new UserFacingError("O motivo do cancelamento passa de 255 caracteres.");
  if (!isUuid(docId)) throw new UserFacingError("Nota fiscal não encontrada.");
  const regras = await getFiscalRegras();
  // A linha fica travada durante a conversa com a SEFAZ (no máximo 30 s): um duplo clique espera e recebe "já foi cancelada".
  // Vale com a NFC-e desligada: o ambiente é o da própria nota.
  await db.transaction(async (tx) => {
    const [doc] = await tx.select().from(fiscalDocuments).where(and(eq(fiscalDocuments.id, docId), eq(fiscalDocuments.kind, "nfce"))).for("update");
    if (!doc) throw new UserFacingError("Nota fiscal não encontrada.");
    if (doc.status === "cancelada") throw new UserFacingError("Essa nota já foi cancelada.");
    if (doc.status !== "autorizada" || !doc.accessKey) throw new UserFacingError("Só nota autorizada pode ser cancelada.");
    const now = deps?.now() ?? new Date();
    const limite = (doc.authorizedAt?.getTime() ?? 0) + regras.nfceCancelarAteMin * 60_000;
    if (now.getTime() > limite) throw new UserFacingError(`A NFC-e só pode ser cancelada até ${regras.nfceCancelarAteMin} minutos depois de autorizada.`);
    const protocolo = nProtOf(doc.responseBody);
    if (!protocolo) throw new UserFacingError("A NFC-e não tem o protocolo de autorização gravado.");
    const d = deps ?? (await realNfceDeps(doc.environment as Env));
    const ev = buildNfceCancelEventXml({ chave: doc.accessKey, protocolo, reason, environment: doc.environment as Env, at: now });
    const signed = signXml(ev.xml, { elementLocalName: "infEvento", id: ev.id, cert: d.cert, algorithm: "sha1" });
    const r = await d.client.cancelar(signed);
    if (!r.ok) throw new UserFacingError(`A SEFAZ não cancelou a NFC-e: ${r.reason}`);
    await tx.update(fiscalDocuments).set({ status: "cancelada", cancelledAt: now, cancelledBy: actor.id, cancelReason: reason }).where(eq(fiscalDocuments.id, doc.id));
    await audit(tx, actor.id, "nota_cancelada", doc.comandaId, { tipo: "nfce", nota: doc.number, chave: doc.accessKey, de: "autorizada", para: "cancelada", motivo: reason }, now);
  });
}
