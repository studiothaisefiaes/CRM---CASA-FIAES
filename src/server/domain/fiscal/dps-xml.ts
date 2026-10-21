import { isAliquotaIssBp, type FiscalEmpresa, type FiscalRegras } from "@/lib/fiscal-settings";
import { UserFacingError } from "../errors";
import type { NfseDraft } from "./draft";

/**
 * DPS (Declaração de Prestação de Serviço) da NFS-e Nacional e o pedido de cancelamento (evento e101101).
 * Valores conferidos no XSD v1.01 (pacote gov.br nfse-esquemas_xsd-v1-01-20260209), Anexo I e Anexo II em 18/10/2026
 * (ver .superpowers/sdd/2026-10-18-fase-d-financeiro-nota/fiscal-conferencia.md, §5 e §6). O XML sai sem espaços nem quebras:
 * depois de assinado, nada pode mudar.
 */

/** Leiaute vigente (conferido no XSD em 18/10/2026: TVerNFSe aceita 1.00 e 1.01; 1.01 é o da "documentação atual"). */
export const DPS_VERSAO = "1.01";
/** Namespace da DPS e do evento (conferido no XSD em 18/10/2026). */
export const NFSE_NS = "http://www.sped.fazenda.gov.br/nfse";
/** IBGE de Salvador (conferido no Anexo A em 18/10/2026). */
export const COD_MUNICIPIO_SALVADOR = "2927408";
/** Tipo de inscrição no Id da DPS: 2 = CNPJ (conferido no XSD TSIdDPS + Anexo I em 18/10/2026). */
const TIPO_INSCRICAO_CNPJ = "2";
/** tpAmb: 1 = Produção; 2 = Homologação (Produção Restrita). Conferido no XSD em 18/10/2026. */
export const TP_AMB = { producao: "1", teste: "2" } as const;
/** verAplic: 1 a 20 caracteres (XSD). */
export const VER_APLIC = "CasaFiaesCRM-1.0";
/** tpEmit 1 = Prestador (XSD, 18/10/2026). */
const TP_EMIT_PRESTADOR = "1";
/**
 * Regime (XSD + Anexo I, 18/10/2026): opSimpNac 1 = não optante, 3 = ME/EPP; regApTribSN 1 = tributos federais e municipal pelo Simples
 * (obrigatório com opSimpNac 3, proibido com 1); regEspTrib 0 = nenhum (obrigatório 0 com opSimpNac 3 e regApTribSN 1).
 */
const REG_TRIB = {
  simples: { opSimpNac: "3", regApTribSN: "1", regEspTrib: "0" },
  presumido: { opSimpNac: "1", regApTribSN: null, regEspTrib: "0" },
} as const;
/** tribISSQN 1 = operação tributável; tpRetISSQN 1 = não retido (XSD, 18/10/2026). */
const TRIB_ISSQN_TRIBUTAVEL = "1", TP_RET_NAO_RETIDO = "1";
/** xDescServ: 1 a 2000 caracteres (XSD, 18/10/2026). */
const X_DESC_SERV_MAX = 2000;
/**
 * pAliq = alíquota do ISS (`empresa.aliquotaIssBp`, 2% a 5%; a faixa cabe no `0|[0-9](\.[0-9]{2})?` do XSD, conferido em 18/10/2026).
 * Não é a alíquota do Simples: essa vai em `pTotTribSN`.
 */
/** Tomador com CPF e sem nome: o XSD exige xNome quando `toma` existe. */
const TOMADOR_SEM_NOME = "Consumidor";
/**
 * Folga do relógio: o Anexo I recusa dhEmi depois da hora do processamento no governo. A DPS sai com 1 minuto a menos
 * (recomendação da conferência de 18/10/2026, §6), mas nunca antes da meia-noite do dia da emissão (para não trocar o dia).
 */
export const DH_EMI_FOLGA_MS = 60_000;
/** Evento de cancelamento (XSD pedRegEvento/tiposEventos v1.01 + Anexo II, 18/10/2026). */
export const EVENTO_CANCELAMENTO = { codigo: "101101", xDesc: "Cancelamento de NFS-e" } as const;
/** xMotivo do cancelamento: TSMotivo, de 15 a 255 caracteres. Regra do leiaute, fixa no código (não é configurável). */
export const MOTIVO_MIN = 15, MOTIVO_MAX = 255;

const BAHIA_OFFSET_MS = 3 * 3_600_000; // America/Bahia, sem horário de verão

export type DpsInput = {
  draft: NfseDraft; empresa: FiscalEmpresa; regras: Pick<FiscalRegras, "informarAliquotaNaDps">;
  environment: "teste" | "producao"; series: number; number: number; emittedAt: Date;
};

/** Escapa texto e atributo; tira caracteres de controle que o XML 1.0 não aceita. */
const esc = (s: string) => s
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const tag = (name: string, value: string) => `<${name}>${esc(value)}</${name}>`;
/** Centavos → "121.50" (ponto e 2 casas, sem passar por float). */
const dec2 = (cents: number) => `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
/** "AAAA-MM-DDThh:mm:ss-03:00" no horário de Salvador. */
const bahiaDateTime = (d: Date) => `${new Date(d.getTime() - BAHIA_OFFSET_MS).toISOString().slice(0, 19)}-03:00`;
const onlyDigits = (s: string) => s.replace(/\D/g, "");
/** Dia "AAAA-MM-DD" em Salvador. */
const bahiaDay = (d: Date) => new Date(d.getTime() - BAHIA_OFFSET_MS).toISOString().slice(0, 10);
/** A hora com a folga, sem cruzar a meia-noite (Salvador) do dia de `at`. */
const withSlack = (at: Date) => new Date(Math.max(at.getTime() - DH_EMI_FOLGA_MS, Date.parse(`${bahiaDay(at)}T00:00:00Z`) + BAHIA_OFFSET_MS));

/** "DPS" + cLocEmi(7) + tipo de inscrição(1) + CNPJ(14) + série(5) + nDPS(15) = 45 caracteres (XSD TSIdDPS, 18/10/2026). */
export function dpsId(cnpj: string, series: number, number: number): string {
  const c = onlyDigits(cnpj);
  if (c.length !== 14) throw new Error("CNPJ do Id da DPS precisa de 14 números.");
  if (!Number.isInteger(series) || series < 1 || series > 99_999) throw new Error("Série da DPS fora da faixa (1 a 99999).");
  if (!Number.isSafeInteger(number) || number < 1 || number > 999_999_999_999_999) throw new Error("Número da DPS fora da faixa (1 a 15 dígitos).");
  return `DPS${COD_MUNICIPIO_SALVADOR}${TIPO_INSCRICAO_CNPJ}${c}${String(series).padStart(5, "0")}${String(number).padStart(15, "0")}`;
}

/** A DPS sem assinatura (a `Signature` entra depois de `infDPS`, por `signXml`). Nunca registrar este XML em log: pode ter CPF. */
export function buildDpsXml(i: DpsInput): { xml: string; id: string } {
  const { draft, empresa } = i;
  if (!empresa.cnpj) throw new UserFacingError("Preencha o CNPJ da Casa em Configurações › Nota fiscal.");
  if (!empresa.regime) throw new UserFacingError("Escolha o regime tributário em Configurações › Nota fiscal.");
  if (!draft.lines.length || draft.totalCents <= 0) throw new UserFacingError("Essa comanda não tem serviço para nota.");
  const codes = [...new Set(draft.lines.map((l) => l.cTribNac))];
  if (codes.length > 1) throw new UserFacingError(`A comanda tem serviços com códigos diferentes (${codes.join(", ")}): uma nota só aceita um código.`);
  const desc = draft.discriminacao.trim();
  if (!desc) throw new UserFacingError("O texto da nota está vazio.");
  if (desc.length > X_DESC_SERV_MAX) throw new UserFacingError(`O texto da nota passa de ${X_DESC_SERV_MAX} caracteres.`);
  const simplesBp = empresa.aliquotaSimplesBp, issBp = empresa.aliquotaIssBp;
  if (i.regras.informarAliquotaNaDps && !isAliquotaIssBp(issBp)) throw new UserFacingError("Informe a alíquota do ISS em Configurações › Nota fiscal.");

  const id = dpsId(empresa.cnpj, i.series, i.number);
  const dhEmi = bahiaDateTime(withSlack(i.emittedAt));
  // A competência é o dia da comanda, sem passar do dia da emissão (a folga não cruza a meia-noite, então dCompet <= dia de dhEmi).
  const emitDay = bahiaDay(i.emittedAt);
  const dCompet = draft.day < emitDay ? draft.day : emitDay;
  const rt = REG_TRIB[empresa.regime];
  const nbs = [...new Set(draft.lines.map((l) => l.nbs))];
  const cpf = draft.tomador.cpf ? onlyDigits(draft.tomador.cpf) : "";

  // Prestador: só CNPJ, IM e regime. Nome e endereço ficam de fora porque, com o prestador emitente, vêm do cadastro nacional
  // (NÃO CONFIRMADO no Anexo I; fonte: clientes open-source). Conferir na Produção Restrita.
  const prest = `<prest>${tag("CNPJ", empresa.cnpj)}${empresa.inscricaoMunicipal ? tag("IM", empresa.inscricaoMunicipal) : ""}`
    + `<regTrib>${tag("opSimpNac", rt.opSimpNac)}${rt.regApTribSN ? tag("regApTribSN", rt.regApTribSN) : ""}${tag("regEspTrib", rt.regEspTrib)}</regTrib></prest>`;
  const toma = cpf.length === 11 ? `<toma>${tag("CPF", cpf)}${tag("xNome", draft.tomador.nome?.trim() || TOMADOR_SEM_NOME)}</toma>` : "";
  const serv = `<serv><locPrest>${tag("cLocPrestacao", COD_MUNICIPIO_SALVADOR)}</locPrest>`
    + `<cServ>${tag("cTribNac", codes[0])}${tag("xDescServ", desc)}${nbs.length === 1 && nbs[0] ? tag("cNBS", nbs[0]) : ""}</cServ></serv>`;
  const pAliq = i.regras.informarAliquotaNaDps ? tag("pAliq", dec2(issBp!)) : "";
  // totTrib: no Simples com a alíquota preenchida, o percentual aproximado do Simples (pTotTribSN); sem ela, indTotTrib 0 (não informar).
  const totTrib = empresa.regime === "simples" && simplesBp != null ? tag("pTotTribSN", dec2(simplesBp)) : tag("indTotTrib", "0");
  const valores = `<valores><vServPrest>${tag("vServ", dec2(draft.totalCents))}</vServPrest>`
    + `<trib><tribMun>${tag("tribISSQN", TRIB_ISSQN_TRIBUTAVEL)}${tag("tpRetISSQN", TP_RET_NAO_RETIDO)}${pAliq}</tribMun><totTrib>${totTrib}</totTrib></trib></valores>`;

  const inf = tag("tpAmb", TP_AMB[i.environment]) + tag("dhEmi", dhEmi) + tag("verAplic", VER_APLIC) + tag("serie", String(i.series)) + tag("nDPS", String(i.number))
    + tag("dCompet", dCompet) + tag("tpEmit", TP_EMIT_PRESTADOR) + tag("cLocEmi", COD_MUNICIPIO_SALVADOR) + prest + toma + serv + valores;
  const xml = `<?xml version="1.0" encoding="UTF-8"?><DPS xmlns="${NFSE_NS}" versao="${DPS_VERSAO}"><infDPS Id="${id}">${inf}</infDPS></DPS>`;
  return { xml, id };
}

export type CancelEventInput = {
  accessKey: string; cnpj: string; environment: "teste" | "producao"; reason: string;
  /** cMotivo: 1 = Erro na emissão; 2 = Serviço não prestado; 9 = Outros (XSD, 18/10/2026). */ code: "1" | "2" | "9"; emittedAt: Date;
};

/** Pedido de registro do evento de cancelamento (sem assinatura; `signXml` com `infPedReg`). Id = "PRE" + chave(50) + "101101" = 59 caracteres. */
export function buildCancelEventXml(i: CancelEventInput): { xml: string; id: string } {
  const reason = i.reason.trim().replace(/\s+/g, " ");
  if (reason.length < MOTIVO_MIN) throw new UserFacingError("Escreva o motivo do cancelamento (pelo menos 15 letras).");
  if (reason.length > MOTIVO_MAX) throw new UserFacingError("O motivo do cancelamento passa de 255 caracteres.");
  if (!/^[0-9]{50}$/.test(i.accessKey)) throw new UserFacingError("Chave de acesso inválida.");
  const cnpj = onlyDigits(i.cnpj);
  if (cnpj.length !== 14) throw new UserFacingError("Preencha o CNPJ da Casa em Configurações › Nota fiscal.");
  if (!["1", "2", "9"].includes(i.code)) throw new UserFacingError("Escolha o motivo do cancelamento.");
  const id = `PRE${i.accessKey}${EVENTO_CANCELAMENTO.codigo}`;
  const inf = tag("tpAmb", TP_AMB[i.environment]) + tag("verAplic", VER_APLIC) + tag("dhEvento", bahiaDateTime(withSlack(i.emittedAt)))
    + tag("CNPJAutor", cnpj) + tag("chNFSe", i.accessKey)
    + `<e${EVENTO_CANCELAMENTO.codigo}>${tag("xDesc", EVENTO_CANCELAMENTO.xDesc)}${tag("cMotivo", i.code)}${tag("xMotivo", reason)}</e${EVENTO_CANCELAMENTO.codigo}>`;
  return { xml: `<?xml version="1.0" encoding="UTF-8"?><pedRegEvento xmlns="${NFSE_NS}" versao="${DPS_VERSAO}"><infPedReg Id="${id}">${inf}</infPedReg></pedRegEvento>`, id };
}
