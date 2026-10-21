import type { PayMethod } from "@/lib/comanda-math";
import type { FiscalEmpresa } from "@/lib/fiscal-settings";
import { UserFacingError } from "../../errors";
import { cNFDe, montarChaveAcesso } from "./chave-acesso";
import { TP_AMB_NFCE } from "./soap";

/**
 * XML da NFC-e (modelo 65, leiaute 4.00): porte de `montarXmlNota` do Norte Vendas, só o modelo 65, com o emitente vindo de
 * Configurações › Nota fiscal (FiscalEmpresa) e os códigos fiscais vindo do cadastro de cada produto. Sai sem espaços nem quebras:
 * depois de assinado, nada pode mudar. Nunca registrar este XML em log (pode ter CPF).
 */
export const NFE_NS = "http://www.portalfiscal.inf.br/nfe";
/** 29 = Bahia (IBGE). */
export const CUF_BA = 29;
/** IBGE de Salvador (Anexo A, conferido em 18/10/2026). */
const CMUN_SALVADOR = "2927408";
const XMUN_SALVADOR = "SALVADOR";
/** verProc: 1 a 20 caracteres. */
const VER_PROC = "CasaFiaesCRM-1.0";
/** CRT 1 = Simples Nacional (a Casa). Presumido usaria CST de ICMS em vez de CSOSN: fora desta fase. */
const CRT_SIMPLES = "1";
/** Origem da mercadoria: 0 = nacional (o cadastro de produto ainda não guarda a origem). */
const ORIGEM_NACIONAL = "0";
/**
 * PIS e COFINS no Simples: CST 07 (operação isenta), grupo PISNT/COFINSNT — o padrão do Norte Vendas, autorizado na homologação da BA.
 * NÃO CONFIRMADO com o contador da Casa: conferir no roteiro (pré-requisitos da NFC-e).
 */
const CST_PIS_COFINS = "07";
/** Texto obrigatório em homologação (a SEFAZ recusa sem ele). */
export const AVISO_HOMOLOGACAO = "NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";
/** xProd: até 120 caracteres; xNome do consumidor: até 60. */
const XPROD_MAX = 120, XNOME_MAX = 60;
/** xJust do cancelamento: TString de 15 a 255 caracteres (regra do leiaute, fixa no código). */
export const JUSTIFICATIVA_MIN = 15, JUSTIFICATIVA_MAX = 255;
const BAHIA_OFFSET_MS = 3 * 3_600_000; // America/Bahia, sem horário de verão

/**
 * Escapa texto. Achado da revisão do Norte Vendas (06/08/2026): nome com "&" ("Fish & Chips") gerava XML malformado, e isso só quebrava
 * DEPOIS de o número fiscal já ter sido gasto. Tira também os caracteres de controle que o XML 1.0 não aceita.
 */
const esc = (s: string) => s
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const tag = (name: string, value: string) => `<${name}>${esc(value)}</${name}>`;
/** Centavos → "121.50" (sem passar por float). */
const dec2 = (cents: number) => `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
/**
 * "AAAA-MM-DDThh:mm:ss-03:00" no horário de Salvador, nunca do relógio cru do processo (no servidor é UTC). Bug real do Norte Vendas
 * (06/08/2026): o relógio UTC rotulado como -03:00 carimbava a nota 3 h no futuro e a SEFAZ recusa (cStat=703).
 */
const bahiaDateTime = (d: Date) => `${new Date(d.getTime() - BAHIA_OFFSET_MS).toISOString().slice(0, 19)}-03:00`;

/** Rateio por maiores restos: cada parte = total × peso / soma (para baixo); os centavos que sobram vão aos maiores restos. Soma exata. */
export function prorate(totalCents: number, weights: { key: string; cents: number }[]): Map<string, number> {
  const out = new Map(weights.map((w) => [w.key, 0]));
  const sum = weights.reduce((a, w) => a + Math.max(0, w.cents), 0);
  if (totalCents <= 0 || sum <= 0) return out;
  const parts = weights.map((w, i) => { const raw = totalCents * Math.max(0, w.cents); return { key: w.key, i, base: Math.floor(raw / sum), rest: raw % sum }; });
  let left = totalCents - parts.reduce((a, p) => a + p.base, 0);
  for (const p of [...parts].sort((a, b) => b.rest - a.rest || a.i - b.i)) { if (left <= 0) break; p.base += 1; left -= 1; }
  for (const p of parts) out.set(p.key, p.base);
  return out;
}

/**
 * Forma de pagamento da SEFAZ (grupo detPag/tPag): dinheiro 01, crédito 03, débito 04, crédito da cliente 05 (crédito loja), Pix 17
 * (pagamento instantâneo), cortesia 90 (sem pagamento), outra 99. Achado real do Norte Vendas (24/08/2026): o `<pag>` vinha sempre
 * "Dinheiro" fixo, mesmo com a venda no cartão ou no Pix.
 */
export function tPagOf(method: PayMethod): "01" | "03" | "04" | "05" | "17" | "90" | "99" {
  switch (method) {
    case "dinheiro": return "01";
    case "credito": return "03";
    case "debito": return "04";
    case "credito_cliente": return "05";
    case "pix": return "17";
    case "cortesia": return "90";
    default: return "99";
  }
}

/**
 * tBand (bandeira) da Nota Técnica 2015/002. As bandeiras de voucher do catálogo (Alelo, Sodexo, Ticket, VR, Cabal) caem de propósito em
 * "99 Outros": o Norte Vendas não pôs os números delas sem conferir a tabela oficial (tBand é informativo; errar o número é pior que 99).
 */
function tBandOf(brand: string | null): string {
  switch (brand) {
    case "visa": return "01";
    case "mastercard": return "02";
    case "amex": return "03";
    case "elo": return "06";
    case "hipercard": return "07";
    default: return "99";
  }
}

/**
 * Código de barras do produto em cEAN/cEANTrib só quando é um GTIN de verdade (8, 12, 13 ou 14 números com o dígito certo): a SEFAZ
 * confere o dígito. Qualquer outro valor vai como "SEM GTIN". NÃO CONFIRMADO: a SEFAZ pode também conferir o GTIN no Cadastro
 * Centralizado; se recusar, apague o código de barras do produto (roteiro, passo 1 da NFC-e).
 */
export function gtinOrSem(barcode: string | null): string {
  const g = (barcode ?? "").trim();
  if (!/^([0-9]{8}|[0-9]{12,14})$/.test(g)) return "SEM GTIN";
  const body = g.slice(0, -1).split("").reverse().map(Number);
  const sum = body.reduce((a, d, i) => a + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(g.at(-1)) ? g : "SEM GTIN";
}

/** CSOSN aceitos e o grupo de ICMS de cada um (Simples Nacional, sem ST nem crédito). */
const CSOSN_GRUPO: Record<string, string> = { "102": "ICMSSN102", "103": "ICMSSN102", "300": "ICMSSN102", "400": "ICMSSN102", "500": "ICMSSN500", "900": "ICMSSN900" };

export type NfceItem = { productId: string; name: string; ncm: string; cfop: string; csosn: string; unit: string; barcode: string | null; qty: number; netCents: number };
/** Uma forma de pagamento com a parte dela no valor dos produtos (já rateada por `prorate`). */
export type NfcePagamento = { method: PayMethod; cents: number; brand: string | null };
export type NfceInput = {
  empresa: FiscalEmpresa; environment: "teste" | "producao"; series: number; number: number; emittedAt: Date;
  /** Só nos testes; na emissão é sorteado. */ cNF?: string;
  itens: NfceItem[]; pagamentos: NfcePagamento[]; consumidor: { cpf: string | null; nome: string | null };
};

/** A NFC-e sem assinatura (a Signature entra depois de infNFe, por `signXml` com SHA-1; o infNFeSupl entra depois de assinar). */
export function buildNfceXml(i: NfceInput): { xml: string; id: string; chave: string; totalCents: number } {
  const e = i.empresa;
  if (!e.cnpj) throw new UserFacingError("Preencha o CNPJ da Casa em Configurações › Nota fiscal.");
  if (e.regime !== "simples") throw new UserFacingError("A NFC-e do CRM só sai no Simples Nacional. Confira o regime em Configurações › Nota fiscal.");
  if (!e.inscricaoEstadual) throw new UserFacingError("Preencha a inscrição estadual da Casa em Configurações › Nota fiscal.");
  if (!e.razaoSocial) throw new UserFacingError("Preencha a razão social da Casa em Configurações › Nota fiscal.");
  if (!e.endereco) throw new UserFacingError("Preencha o endereço da Casa em Configurações › Nota fiscal.");
  const itens = i.itens.filter((x) => x.netCents > 0);
  if (!itens.length) throw new UserFacingError("Essa comanda não tem produto para nota.");
  for (const it of itens) {
    if (!/^[0-9]{8}$/.test(it.ncm)) throw new UserFacingError(`Produto ${it.name} sem NCM: complete em Serviços e pacotes › Produtos.`);
    if (!CSOSN_GRUPO[it.csosn]) throw new UserFacingError(`O CSOSN ${it.csosn} do produto ${it.name} ainda não sai na NFC-e do CRM: use 102, 103, 300, 400, 500 ou 900.`);
    if (!/^[0-9]{4}$/.test(it.cfop)) throw new UserFacingError(`O CFOP do produto ${it.name} tem 4 números.`);
  }
  const totalCents = itens.reduce((a, x) => a + x.netCents, 0);
  const pags = i.pagamentos.filter((p) => p.cents > 0);
  if (pags.reduce((a, p) => a + p.cents, 0) !== totalCents) throw new UserFacingError("As formas de pagamento não fecham com o valor dos produtos.");

  const tpAmb = TP_AMB_NFCE[i.environment];
  const local = bahiaDateTime(i.emittedAt);
  const anoMes = local.slice(2, 4) + local.slice(5, 7);
  const cNF = i.cNF ?? cNFDe(i.number);
  const chave = montarChaveAcesso({ cUF: CUF_BA, anoMes, cnpj: e.cnpj, serie: i.series, numero: i.number, tpEmis: 1, cNF });
  const id = `NFe${chave}`;

  const ide = tag("cUF", String(CUF_BA)) + tag("cNF", cNF) + tag("natOp", "VENDA AO CONSUMIDOR") + tag("mod", "65") + tag("serie", String(i.series)) + tag("nNF", String(i.number))
    + tag("dhEmi", local) + tag("tpNF", "1") + tag("idDest", "1") + tag("cMunFG", CMUN_SALVADOR) + tag("tpImp", "4") + tag("tpEmis", "1") + tag("cDV", chave.slice(-1))
    + tag("tpAmb", tpAmb) + tag("finNFe", "1") + tag("indFinal", "1") + tag("indPres", "1") + tag("procEmi", "0") + tag("verProc", VER_PROC);
  const end = e.endereco;
  const emit = tag("CNPJ", e.cnpj) + tag("xNome", e.razaoSocial)
    + `<enderEmit>${tag("xLgr", end.logradouro)}${tag("nro", end.numero)}${tag("xBairro", end.bairro)}${tag("cMun", CMUN_SALVADOR)}${tag("xMun", XMUN_SALVADOR)}${tag("UF", "BA")}${tag("CEP", end.cep.replace(/\D/g, ""))}${tag("cPais", "1058")}${tag("xPais", "BRASIL")}</enderEmit>`
    + tag("IE", e.inscricaoEstadual.replace(/\D/g, "")) + tag("CRT", CRT_SIMPLES);

  // CPF na nota (opcional): <dest> mínimo. `indIEDest` é OBRIGATÓRIO no <dest> (9 = não contribuinte); sem ele a SEFAZ recusa com
  // cStat=225 "Falha no Schema XML" (Norte Vendas, homologação do Sertão, 22/09/2026). Sem CPF, cupom anônimo, sem <dest>.
  const cpf = (i.consumidor.cpf ?? "").replace(/\D/g, "");
  const nome = (i.consumidor.nome ?? "").trim();
  const dest = cpf.length === 11 ? `<dest>${tag("CPF", cpf)}${tag("xNome", (nome && nome.toLowerCase() !== "consumidor" ? nome : "CONSUMIDOR").slice(0, XNOME_MAX))}${tag("indIEDest", "9")}</dest>` : "";

  const det = itens.map((it, k) => {
    // cStat=373 (Norte Vendas, 06/08/2026): em homologação o xProd do PRIMEIRO item tem que ser EXATAMENTE o aviso, sem nada antes ou depois.
    const xProd = tpAmb === "2" && k === 0 ? AVISO_HOMOLOGACAO : it.name.slice(0, XPROD_MAX);
    const gtin = gtinOrSem(it.barcode);
    // O valor do item na nota é o líquido (já sem o desconto e a cortesia rateados): vUnCom = líquido / quantidade, com 10 casas.
    const vUn = (it.netCents / 100 / it.qty).toFixed(10);
    const grupo = CSOSN_GRUPO[it.csosn];
    return `<det nItem="${k + 1}"><prod>${tag("cProd", it.productId)}${tag("cEAN", gtin)}${tag("xProd", xProd)}${tag("NCM", it.ncm)}${tag("CFOP", it.cfop)}${tag("uCom", it.unit)}`
      + `${tag("qCom", it.qty.toFixed(4))}${tag("vUnCom", vUn)}${tag("vProd", dec2(it.netCents))}${tag("cEANTrib", gtin)}${tag("uTrib", it.unit)}${tag("qTrib", it.qty.toFixed(4))}${tag("vUnTrib", vUn)}`
      + `${tag("indTot", "1")}</prod><imposto><ICMS><${grupo}>${tag("orig", ORIGEM_NACIONAL)}${tag("CSOSN", it.csosn)}</${grupo}></ICMS>`
      + `<PIS><PISNT>${tag("CST", CST_PIS_COFINS)}</PISNT></PIS><COFINS><COFINSNT>${tag("CST", CST_PIS_COFINS)}</COFINSNT></COFINS></imposto></det>`;
  }).join("");

  const v = dec2(totalCents);
  const total = `<total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet>`
    + `${tag("vProd", v)}<vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro>${tag("vNF", v)}</ICMSTot></total>`;

  const pag = pags.map((p) => {
    const tPag = tPagOf(p.method);
    // cStat=391 "Não informados os dados do cartão de crédito/débito" (Norte Vendas, produção, 25/08/2026): a SEFAZ exige o grupo <card>
    // em TODO detPag com tPag 03 ou 04. tpIntegra=2 ("não integrado": a maquininha não fala com o CRM) dispensa CNPJ da credenciadora e
    // código de autorização, que o CRM não captura. tBand vai sempre que der para mapear a bandeira (99 Outros no resto).
    // A NT 2025.001 (vigente desde 01/09/2025) passou a exigir o <card> também no Pix (tPag 17): mesma rejeição 391 numa venda ao vivo
    // do Norte Vendas em 27/08/2026. No Pix não existe bandeira: só o tpIntegra=2.
    const card = tPag === "03" || tPag === "04" ? `<card>${tag("tpIntegra", "2")}${tag("tBand", tBandOf(p.brand))}</card>` : tPag === "17" ? `<card>${tag("tpIntegra", "2")}</card>` : "";
    // tPag 99 exige a descrição do meio (xPag) — NT 2020.006.
    const xPag = tPag === "99" ? tag("xPag", "Outra forma") : "";
    return `<detPag>${tag("indPag", "0")}${tag("tPag", tPag)}${xPag}${tag("vPag", dec2(p.cents))}${card}</detPag>`;
  }).join("");

  const xml = `<NFe xmlns="${NFE_NS}"><infNFe Id="${id}" versao="4.00"><ide>${ide}</ide><emit>${emit}</emit>${dest}${det}${total}<transp><modFrete>9</modFrete></transp><pag>${pag}</pag></infNFe></NFe>`;
  return { xml, id, chave, totalCents };
}

/**
 * Pedido de cancelamento da NFC-e: evento 110111 ("Cancelamento"), leiaute 1.00 (porte de `montarEventoCancelamento`). cOrgao = a UF do
 * emitente (29: o evento vai para a SVRS, mas o órgão continua a BA); CNPJ = números 7 a 20 da chave; nSeqEvento = 1 (só se cancela uma vez).
 */
export function buildNfceCancelEventXml(i: { chave: string; protocolo: string; reason: string; environment: "teste" | "producao"; at: Date }): { xml: string; id: string } {
  // xJust: TString (sem espaço nas pontas nem repetido), de 15 a 255 caracteres.
  const just = i.reason.replace(/\s+/g, " ").trim();
  if (just.length < JUSTIFICATIVA_MIN) throw new UserFacingError("Escreva o motivo do cancelamento (pelo menos 15 letras).");
  if (just.length > JUSTIFICATIVA_MAX) throw new UserFacingError("O motivo do cancelamento passa de 255 caracteres.");
  if (!/^[0-9]{44}$/.test(i.chave)) throw new UserFacingError("Chave de acesso inválida.");
  if (!/^[0-9]{15}$/.test(i.protocolo)) throw new UserFacingError("A NFC-e não tem o protocolo de autorização gravado.");
  const id = `ID110111${i.chave}01`;
  const inf = tag("cOrgao", i.chave.slice(0, 2)) + tag("tpAmb", TP_AMB_NFCE[i.environment]) + tag("CNPJ", i.chave.slice(6, 20)) + tag("chNFe", i.chave)
    + tag("dhEvento", bahiaDateTime(i.at)) + tag("tpEvento", "110111") + tag("nSeqEvento", "1") + tag("verEvento", "1.00")
    + `<detEvento versao="1.00">${tag("descEvento", "Cancelamento")}${tag("nProt", i.protocolo)}${tag("xJust", just)}</detEvento>`;
  return { xml: `<evento xmlns="${NFE_NS}" versao="1.00"><infEvento Id="${id}">${inf}</infEvento></evento>`, id };
}

/** nfeProc = a NFC-e assinada + o protNFe: o arquivo que vale como a nota (o que a Casa guarda e o contador recebe). */
export const nfeProcOf = (signedNfe: string, protNFe: string) => `<nfeProc xmlns="${NFE_NS}" versao="4.00">${signedNfe}${protNFe}</nfeProc>`;
