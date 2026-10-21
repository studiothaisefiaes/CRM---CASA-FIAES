import { and, asc, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { db, type Db, type Tx } from "../../db";
import { comandaItems, comandas, fiscalDocuments, lists, professionals } from "../../db/schema";
import { formatCnpj } from "@/lib/cnpj";
import { DEFAULT_FISCAL_REGRAS, fillFiscalText, type FiscalModo, type FiscalRegras, type FiscalTextos } from "@/lib/fiscal-settings";
import { getFiscalEmpresa, getFiscalRegras, getNfceModo, getNfseModo } from "./config";
import { qrCodeOf } from "./nfce/qrcode";

/**
 * Rascunho da NFS-e de uma comanda fechada (Fase D, Task 10): só serviços (e a venda de pacote), com o valor líquido de cada linha,
 * a cota de cada parceira e o texto da discriminação. Serve com a chave desligada (a recepção copia para o nfse.gov.br) e é a base da emissão.
 */
export type NfseDraftLine = {
  itemId: string; label: string; netCents: number; professional: string | null;
  partner: { legalName: string; cnpj: string } | null; cTribNac: string; nbs: string | null;
};
export type NfseDraft = {
  comandaId: string; comandaNumber: number; day: string; tomador: { cpf: string | null; nome: string | null };
  lines: NfseDraftLine[]; totalCents: number; salaoCents: number;
  parceiras: { legalName: string; cnpj: string; cents: number }[]; discriminacao: string;
  /** Parceiras (vínculo `parceira`) com serviço na comanda e sem CNPJ no fechamento: a cota-parte delas não entra no texto. */
  parceirasSemCnpj: string[];
  /** Frases para o bloco da comanda (hoje: parceira sem CNPJ). */
  avisos: string[];
};
type DraftBase = Omit<NfseDraft, "discriminacao" | "avisos" | "parceirasSemCnpj">;

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
/** "R$ 1.234,50": sempre 2 casas e espaço comum (o `money()` da tela corta o ",00" e usa espaço não separável). */
const brl = (cents: number) => BRL.format(cents / 100).replace(/[  ]/g, " ");

/** O texto da nota (puro). Os modelos vêm de `fiscal_regras.textos`; a parte da parceria só entra quando há parceira. */
export function buildDiscriminacao(d: DraftBase, textos: FiscalTextos = DEFAULT_FISCAL_REGRAS.textos): string {
  const base = fillFiscalText(textos.servicos, { servicos: d.lines.map((l) => l.label).join(", ") });
  if (!d.parceiras.length) return base;
  const cotas = d.parceiras.map((p) => fillFiscalText(textos.cotaParceira, { razao_social: p.legalName, cnpj: formatCnpj(p.cnpj), valor: brl(p.cents) })).join("; ");
  return base + fillFiscalText(textos.parceria, { cota_salao: brl(d.salaoCents), cotas_parceiras: cotas });
}

/** null = nada a declarar (só produto, só sessão de pacote, ou sem valor). */
export async function loadNfseDraft(comandaId: string, q: Tx | Db = db): Promise<NfseDraft | null> {
  const [c] = await q.select().from(comandas).where(eq(comandas.id, comandaId));
  if (!c) return null;
  const [empresa, regras] = await Promise.all([getFiscalEmpresa(q), getFiscalRegras(q)]);
  const x = await q.select({ i: comandaItems, pro: professionals, ctrib: lists.fiscalCtribNac, nbs: lists.fiscalNbs })
    .from(comandaItems).leftJoin(professionals, eq(professionals.id, comandaItems.professionalId)).leftJoin(lists, eq(lists.id, comandaItems.serviceId))
    .where(and(eq(comandaItems.comandaId, comandaId), isNull(comandaItems.cancelledAt), eq(comandaItems.fiscalKind, "servico"), inArray(comandaItems.kind, ["servico", "pacote_venda"])))
    .orderBy(asc(comandaItems.createdAt), asc(comandaItems.id));
  const lines: NfseDraftLine[] = [];
  const cotas = new Map<string, { legalName: string; cnpj: string; cents: number }>();
  const semCnpj = new Set<string>();
  for (const { i, pro, ctrib, nbs } of x) {
    const netCents = i.netCents ?? 0;
    if (netCents <= 0) continue;
    // Parceira sem CNPJ no fechamento (partner_cnpj null): a linha sai como serviço do salão; o bloco avisa e a emissão recusa.
    if (!i.partnerCnpj && pro?.bond === "parceira") semCnpj.add(pro.name);
    const partner = i.partnerCnpj ? { legalName: pro?.legalName?.trim() || pro?.fullName?.trim() || pro?.name || "", cnpj: i.partnerCnpj } : null;
    lines.push({ itemId: i.id, label: i.label, netCents, professional: pro?.name ?? null, partner, cTribNac: ctrib || empresa.cTribNacPadrao, nbs: nbs || empresa.nbsPadrao });
    if (partner) {
      const k = partner.cnpj, cur = cotas.get(k) ?? { ...partner, cents: 0 };
      cur.cents += i.commissionCents ?? 0; cotas.set(k, cur);
    }
  }
  if (!lines.length) return null;
  const totalCents = lines.reduce((a, l) => a + l.netCents, 0);
  const parceiras = [...cotas.values()];
  const d: DraftBase = {
    comandaId, comandaNumber: c.number, day: c.day, tomador: { cpf: c.cpf, nome: c.clientName }, lines, totalCents,
    salaoCents: totalCents - parceiras.reduce((a, p) => a + p.cents, 0), parceiras,
  };
  const parceirasSemCnpj = [...semCnpj];
  return { ...d, discriminacao: buildDiscriminacao(d, regras.textos), parceirasSemCnpj, avisos: parceirasSemCnpj.map(avisoSemCnpj) };
}
const avisoSemCnpj = (nome: string) => `A parceira ${nome} está sem CNPJ: a cota-parte dela não entrou no texto. Cadastre o CNPJ em Configurações › Profissionais.`;

/** O que o bloco "Nota fiscal" da comanda fechada precisa (a tela só desenha). */
export type NotaFiscalInfo = {
  modo: FiscalModo;
  /** Dados para copiar: só com a chave desligada, a comanda fechada, algo a declarar e `fiscal_regras.rascunhoNaComanda` ligado. */
  dados: { cpf: string | null; discriminacao: string; valor: string; valorCents: number; codigoServico: string } | null;
  /** A nota mais recente da comanda (qualquer situação), para a chave em teste ou produção. */
  documento: { id: string; environment: string; status: string; number: number; amountCents: number; rejectReason: string | null; accessKey: string | null; attempts: number } | null;
  /** Chave em teste ou produção, sem nota e sem serviço a declarar: o bloco não oferece "Emitir nota". */
  semServico?: true;
  /** Avisos do rascunho (parceira sem CNPJ), com destaque no bloco; só vem quando há algum. */
  avisos?: string[];
  /** O que quem vê pode fazer (nota.emitir, nota.cancelar, nota.ver, nota.resolver); preenchido por getComandaDetail. Vale para as duas notas. */
  acoes?: { emitir: boolean; cancelar: boolean; ver: boolean; resolver?: boolean };
  /** "Nota de produto (NFC-e)" (Task 13): só com a NFC-e ligada ou com uma NFC-e já emitida. */
  nfce?: NfceInfo;
};
export type NfceInfo = {
  modo: FiscalModo;
  /** A NFC-e mais recente da comanda, com o link do QR Code e até quando dá para cancelar (ISO; Configurações › Nota fiscal). */
  documento: { id: string; environment: string; status: string; number: number; amountCents: number; rejectReason: string | null; accessKey: string | null; consultaUrl: string | null; cancelarAte: string | null; attempts: number } | null;
  /** NFC-e ligada, sem nota e sem produto a declarar: o bloco não oferece "Emitir NFC-e". */
  semProduto?: true;
};

const docsOf = (comandaId: string, kind: "nfse" | "nfce") =>
  db.select().from(fiscalDocuments).where(and(eq(fiscalDocuments.comandaId, comandaId), eq(fiscalDocuments.kind, kind))).orderBy(desc(fiscalDocuments.createdAt));
/**
 * A nota que o bloco mostra: com a chave em Teste ou Produção, a mais recente DAQUELE ambiente (a de Teste não ocupa o lugar da de
 * Produção, I-3); com a chave desligada, a mais recente de qualquer ambiente (para ver, baixar e cancelar).
 */
const docDoModo = <T extends { environment: string }>(docs: T[], modo: FiscalModo): T | undefined =>
  modo === "desligada" ? docs[0] : docs.find((d) => d.environment === modo);

/** A linha da NFC-e da comanda, ou undefined quando a NFC-e está desligada e nunca saiu uma. */
async function loadNfceInfo(comandaId: string, cancelarAteMin: number): Promise<NfceInfo | undefined> {
  const [modo, docs] = await Promise.all([getNfceModo(), docsOf(comandaId, "nfce")]);
  const doc = docDoModo(docs, modo);
  if (doc) {
    const ok = doc.status === "autorizada" || doc.status === "cancelada";
    return { modo, documento: {
      id: doc.id, environment: doc.environment, status: doc.status, number: doc.number, amountCents: doc.amountCents, rejectReason: doc.rejectReason, accessKey: doc.accessKey,
      consultaUrl: ok ? qrCodeOf(doc.requestXml) : null,
      cancelarAte: doc.status === "autorizada" && doc.authorizedAt ? new Date(doc.authorizedAt.getTime() + cancelarAteMin * 60_000).toISOString() : null,
      attempts: doc.attempts,
    } };
  }
  if (modo === "desligada") return undefined;
  const [produto] = await db.select({ id: comandaItems.id }).from(comandaItems)
    .where(and(eq(comandaItems.comandaId, comandaId), isNull(comandaItems.cancelledAt), eq(comandaItems.kind, "produto"), gt(comandaItems.netCents, 0))).limit(1);
  return produto ? { modo, documento: null } : { modo, documento: null, semProduto: true };
}

export async function loadNotaFiscalInfo(comandaId: string): Promise<NotaFiscalInfo> {
  const [modo, regras] = await Promise.all([getNfseModo(), getFiscalRegras()]);
  const nfce = await loadNfceInfo(comandaId, regras.nfceCancelarAteMin);
  return { ...(await loadNfseInfo(comandaId, modo, regras)), ...(nfce ? { nfce } : {}) };
}

const avisosOf = (d: NfseDraft) => (d.avisos.length ? { avisos: d.avisos } : {});

async function loadNfseInfo(comandaId: string, modo: FiscalModo, regras: FiscalRegras): Promise<NotaFiscalInfo> {
  // A nota já emitida aparece sempre, mesmo com a chave desligada depois (para ver, baixar e cancelar).
  const doc = docDoModo(await docsOf(comandaId, "nfse"), modo);
  const documento = doc ? { id: doc.id, environment: doc.environment, status: doc.status, number: doc.number, amountCents: doc.amountCents, rejectReason: doc.rejectReason, accessKey: doc.accessKey, attempts: doc.attempts } : null;
  if (modo === "desligada") {
    if (!regras.rascunhoNaComanda) return { modo, dados: null, documento };
    const d = await loadNfseDraft(comandaId);
    if (!d) return { modo, dados: null, documento };
    const codes = [...new Set(d.lines.map((l) => l.cTribNac))];
    return { modo, documento, ...avisosOf(d), dados: { cpf: d.tomador.cpf, discriminacao: d.discriminacao, valor: brl(d.totalCents).replace("R$ ", ""), valorCents: d.totalCents, codigoServico: codes.join(", ") } };
  }
  const d = await loadNfseDraft(comandaId);
  if (!documento) return d ? { modo, dados: null, documento: null, ...avisosOf(d) } : { modo, dados: null, documento: null, semServico: true };
  return { modo, dados: null, documento, ...(d ? avisosOf(d) : {}) };
}
