import { request } from "node:https";
import type { FiscalCert } from "../certificate";

/**
 * Conversa com a SEFAZ da NFC-e (porte de `lib/fiscal/soap.ts` e `cancelamento.ts` do Norte Vendas): SOAP 1.2 com mTLS (o A1 da Casa).
 * Conferência em fonte oficial de 18/10/2026: .superpowers/sdd/2026-10-18-fase-d-financeiro-nota/fiscal-conferencia.md (§12).
 * Nunca registrar em log o XML (pode ter CPF) nem o corpo das respostas.
 */

/**
 * A Bahia delega o modelo 65 para a SEFAZ VIRTUAL DO RS (SVRS); só o modelo 55 fica na infraestrutura própria da BA. O Norte Vendas mandou
 * a NFC-e para o webservice de NF-e da BA três vezes e levou `cStat=702` ("NFC-e não é aceita pela UF do Emitente"); apontando para a
 * SVRS, a mesma loja foi autorizada em 04/08/2026. CONFIRMADO em 18/10/2026 no portal SVRS e na página de NFC-e da SEFAZ-BA (§12).
 */
export const SVRS_NFCE = {
  teste: {
    autorizacao: "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
    consulta: "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
    evento: "https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
  },
  producao: {
    autorizacao: "https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
    consulta: "https://nfce.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
    evento: "https://nfce.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
  },
} as const;

/**
 * URLs que vão DENTRO da NFC-e (infNFeSupl: qrCode e urlChave). A SEFAZ não valida essas strings no envio (só o hash do QR Code), mas o
 * cupom tem que apontar para o ambiente certo, senão a cliente consulta a nota no host errado (bug real do Norte Vendas, corrigido em
 * 05/08/2026: ficava sempre a de homologação). CONFIRMADO em 18/10/2026 no ENCAT (§12), produção e homologação.
 */
export const NFCE_CONSULTA_BA = {
  teste: { urlQrCode: "http://hnfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx", urlChave: "http://hinternet.sefaz.ba.gov.br/nfce/consulta" },
  producao: { urlQrCode: "http://nfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx", urlChave: "http://www.sefaz.ba.gov.br/nfce/consulta" },
} as const;

const NFE_NS = "http://www.portalfiscal.inf.br/nfe";
const WSDL = "http://www.portalfiscal.inf.br/nfe/wsdl";
/** Serviço e operação de cada chamada (WSDL 4.00). A consulta por chave (NFeConsultaProtocolo4) não estava no código do Norte Vendas: lá ela foi
 * feita à mão para conferir a autorização; o nome da operação vem do WSDL e fica para conferir no roteiro (passo 2 da NFC-e). */
const SERVICO = {
  autorizar: { wsdl: `${WSDL}/NFeAutorizacao4`, op: "nfeAutorizacaoLote" },
  consultar: { wsdl: `${WSDL}/NFeConsultaProtocolo4`, op: "nfeConsultaNF" },
  evento: { wsdl: `${WSDL}/NFeRecepcaoEvento4`, op: "nfeRecepcaoEvento" },
} as const;
export const TP_AMB_NFCE = { producao: "1", teste: "2" } as const;
/** Tempo máximo esperando a SEFAZ (o worker tenta de novo depois). */
export const SVRS_TIMEOUT_MS = 30_000;
/** Teto do corpo da resposta: uma resposta da SEFAZ tem poucos KB. */
export const SVRS_MAX_RESPOSTA_BYTES = 5 * 1024 * 1024;

export type SvrsTransport = (r: { url: string; action: string; body: string }) => Promise<{ status: number; body: string }>;
export type AutorizacaoResult =
  | { kind: "autorizada"; protNFe: string; nProt: string; dhRecbto: string | null }
  | { kind: "rejeitada"; reason: string; raw: string }
  | { kind: "falha"; error: string };
export type ConsultaResult =
  | { kind: "existe"; protNFe: string | null; nProt: string | null; dhRecbto: string | null; cStat: string }
  | { kind: "cancelada"; cStat: string; body: string }
  | { kind: "nao_existe" }
  | { kind: "falha"; error: string };

const envelope = (s: { wsdl: string }, inner: string) =>
  `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">`
  + `<soap12:Body><nfeDadosMsg xmlns="${s.wsdl}">${inner}</nfeDadosMsg></soap12:Body></soap12:Envelope>`;
const pick = (xml: string, tag: string) => xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1] ?? null;
const offline = (e: unknown) => `Sem resposta da SEFAZ: ${e instanceof Error ? e.message : String(e)}`;
const comCodigo = (xMotivo: string | null, cStat: string) => `${xMotivo ?? "Sem descrição"} (cStat ${cStat})`;

/**
 * Códigos em que a SEFAZ NÃO analisou o documento (fora do ar, paralisada, sobrecarregada): reenviar o MESMO XML depois pode autorizar.
 * Tratar como rejeição mataria a nota (Norte Vendas, `ehSefazIndisponivel`). `null` (página de erro do gateway, corpo vazio) entra junto.
 *   105 Lote em processamento · 106 Lote não localizado · 108 Serviço paralisado momentaneamente · 109 Serviço paralisado sem previsão
 */
export const ehSefazIndisponivel = (cStat: string | null) => cStat === null || ["105", "106", "108", "109"].includes(cStat);
/** 100 = autorizado o uso; 150 = autorizado fora de prazo. */
const AUTORIZADO = ["100", "150"];

/**
 * BUG CRÍTICO do Norte Vendas (05/08/2026): no envio síncrono, o `retEnviNFe` tem DOIS cStat — o do LOTE na raiz (104 "Lote processado",
 * que NÃO é autorização) e o da NOTA dentro de `<protNFe><infProt>`. Ler o primeiro `<cStat>` do corpo pega sempre o 104. Por isso o
 * `protNFe` é extraído primeiro e o cStat da nota vem de dentro dele; sem `protNFe` (recusa de lote ou de schema), vale o do lote.
 */
export function parseRetorno(xml: string) {
  const cStatLote = pick(xml, "cStat");
  const protNFe = xml.match(/<protNFe[\s\S]*?<\/protNFe>/)?.[0] ?? null;
  const src = protNFe ?? xml;
  return { cStatLote, protNFe, cStat: protNFe ? pick(protNFe, "cStat") : cStatLote, xMotivo: pick(src, "xMotivo"), nProt: protNFe ? pick(protNFe, "nProt") : null, dhRecbto: protNFe ? pick(protNFe, "dhRecbto") : null };
}

/** Mensagem da recusa do cancelamento (Norte Vendas, `mensagemRejeicaoCancelamento`), sempre com o código cru para o suporte. */
function recusaCancelamento(cStat: string | null, xMotivo: string | null): string {
  const cru = cStat ? ` (SEFAZ ${cStat}${xMotivo ? `: ${xMotivo}` : ""})` : "";
  switch (cStat) {
    case "501": case "220": return `O prazo legal para cancelar esta nota já passou.${cru}`;
    case "573": return `Já existe um pedido de cancelamento registrado para esta nota na SEFAZ.${cru}`;
    case "218": return `Esta nota já está cancelada na SEFAZ.${cru}`;
    case "580": case "420": return `A SEFAZ não reconhece esta nota como autorizada.${cru}`;
    case "222": return `O protocolo de autorização gravado não confere com o da SEFAZ.${cru}`;
    case "217": return `A SEFAZ não encontrou esta nota neste ambiente.${cru}`;
    case "108": case "109": return `A SEFAZ está fora do ar no momento. Tente de novo em alguns minutos.${cru}`;
    case null: return "A SEFAZ não devolveu uma resposta válida. Tente de novo em alguns minutos.";
    default: return `A SEFAZ recusou o cancelamento.${cru}`;
  }
}

export function createSvrsClient(o: { environment: "teste" | "producao"; transport?: SvrsTransport; cert?: FiscalCert }) {
  const urls = SVRS_NFCE[o.environment];
  const tpAmb = TP_AMB_NFCE[o.environment];
  const transport = o.transport ?? (o.cert ? svrsHttpsTransport(o.cert) : null);
  if (!transport) throw new Error("Sem certificado digital para falar com a SEFAZ.");
  const call = async (url: string, s: { wsdl: string; op: string }, inner: string) => transport({ url, action: `${s.wsdl}/${s.op}`, body: envelope(s, inner) });

  return {
    /**
     * Envia a NFC-e assinada (com o infNFeSupl), síncrona (indSinc=1). 204 (duplicidade) quer dizer que um envio anterior já chegou:
     * vira falha e a próxima tentativa CONSULTA pela chave (reenviar uma chave já autorizada não devolve o protocolo, devolve 204 —
     * confirmado pelo Norte Vendas em 16/09/2026).
     */
    async autorizar(signedNfe: string, idLote: string): Promise<AutorizacaoResult> {
      let r: { status: number; body: string };
      try { r = await call(urls.autorizacao, SERVICO.autorizar, `<enviNFe xmlns="${NFE_NS}" versao="4.00"><idLote>${idLote}</idLote><indSinc>1</indSinc>${signedNfe}</enviNFe>`); }
      catch (e) { return { kind: "falha", error: offline(e) }; }
      const p = parseRetorno(r.body);
      if (p.cStat && AUTORIZADO.includes(p.cStat) && p.protNFe && p.nProt) return { kind: "autorizada", protNFe: p.protNFe, nProt: p.nProt, dhRecbto: p.dhRecbto };
      if (ehSefazIndisponivel(p.cStat)) return { kind: "falha", error: p.cStat ? `A SEFAZ está indisponível: ${comCodigo(p.xMotivo, p.cStat)}` : `A SEFAZ respondeu sem resultado (HTTP ${r.status}).` };
      if (p.cStat === "204") return { kind: "falha", error: `A SEFAZ diz que essa NFC-e já foi recebida: o sistema confere pela chave. ${comCodigo(p.xMotivo, p.cStat)}` };
      return { kind: "rejeitada", reason: comCodigo(p.xMotivo, p.cStat!), raw: r.body };
    },

    /** A chave já virou nota? (NFeConsultaProtocolo4.) Usada antes de reenviar e antes de reabrir a comanda: nunca duplicar. */
    async consultar(chave: string): Promise<ConsultaResult> {
      if (!/^[0-9]{44}$/.test(chave)) return { kind: "falha", error: "Chave de acesso inválida." };
      let r: { status: number; body: string };
      try { r = await call(urls.consulta, SERVICO.consultar, `<consSitNFe xmlns="${NFE_NS}" versao="4.00"><tpAmb>${tpAmb}</tpAmb><xServ>CONSULTAR</xServ><chNFe>${chave}</chNFe></consSitNFe>`); }
      catch (e) { return { kind: "falha", error: offline(e) }; }
      const cStat = pick(r.body, "cStat"), xMotivo = pick(r.body, "xMotivo");
      const p = parseRetorno(r.body);
      if (cStat && AUTORIZADO.includes(cStat)) return { kind: "existe", protNFe: p.protNFe, nProt: p.nProt, dhRecbto: p.dhRecbto, cStat };
      // 101/151/155: saiu e já foi cancelada (fora do CRM). A nota fica `cancelada` no CRM: não trava a comanda nem passa por autorizada.
      if (cStat && ["101", "151", "155"].includes(cStat)) return { kind: "cancelada", cStat, body: r.body };
      if (cStat === "217") return { kind: "nao_existe" }; // "NF-e não consta na base de dados da SEFAZ"
      return { kind: "falha", error: cStat ? `A SEFAZ não confirmou a situação: ${comCodigo(xMotivo, cStat)}` : `A SEFAZ respondeu sem resultado (HTTP ${r.status}).` };
    },

    /** Registra o evento 110111 já assinado. 135 = registrado e vinculado; 155 = cancelamento homologado fora de prazo. */
    async cancelar(signedEvento: string): Promise<{ ok: true; retEvento: string } | { ok: false; reason: string }> {
      let r: { status: number; body: string };
      // idLote: até 15 números; o instante basta (um evento por lote).
      try { r = await call(urls.evento, SERVICO.evento, `<envEvento xmlns="${NFE_NS}" versao="1.00"><idLote>${String(Date.now()).slice(-15)}</idLote>${signedEvento}</envEvento>`); }
      catch (e) { return { ok: false, reason: offline(e) }; }
      // Dois níveis de cStat, como na autorização: o do lote (128) não diz nada; vale o de dentro de <retEvento>.
      const ret = r.body.match(/<retEvento[\s\S]*?<\/retEvento>/)?.[0] ?? null;
      const cStat = pick(ret ?? r.body, "cStat"), xMotivo = pick(ret ?? r.body, "xMotivo");
      if (ret && (cStat === "135" || cStat === "155")) return { ok: true, retEvento: ret };
      return { ok: false, reason: recusaCancelamento(cStat, xMotivo) };
    },
  };
}
export type SvrsClient = ReturnType<typeof createSvrsClient>;

/**
 * Transporte de verdade: SOAP 1.2 por node:https com o A1 da Casa (mTLS), timeout de 30 s. A verificação do certificado do servidor fica
 * LIGADA. O Norte Vendas desligou a verificação porque o Node não traz a cadeia ICP-Brasil; aqui a saída é `NODE_EXTRA_CA_CERTS=<cadeia
 * ICP-Brasil .pem>` no ambiente do processo (pm2), que vale para a SVRS e a Sefin (docs/fiscal/roteiro-homologacao.md).
 * SEGURANÇA: nunca é criado nos testes; nenhum teste fala com a SVRS.
 */
export function svrsHttpsTransport(cert: FiscalCert, timeoutMs = SVRS_TIMEOUT_MS): SvrsTransport {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) throw new Error("Transporte real desligado nos testes.");
  return (r) => new Promise((resolve, reject) => {
    const u = new URL(r.url);
    const req = request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname, method: "POST", timeout: timeoutMs,
      cert: [cert.certPem, ...cert.chainPem].join("\n"), key: cert.keyPem, // a cadeia vai junto: sem ela o IIS da SEFAZ devolve 403
      headers: { "Content-Type": `application/soap+xml; charset=utf-8; action="${r.action}"`, "Content-Length": Buffer.byteLength(r.body) },
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > SVRS_MAX_RESPOSTA_BYTES) { req.destroy(new Error("resposta grande demais (mais de 5 MB)")); return; }
        chunks.push(c);
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error(`tempo esgotado (${Math.round(timeoutMs / 1000)} s)`)));
    req.on("error", reject);
    req.write(r.body);
    req.end();
  });
}
