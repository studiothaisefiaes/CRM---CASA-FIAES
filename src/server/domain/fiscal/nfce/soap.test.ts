import { describe, expect, it } from "vitest";
import { makeTestPfx, TEST_PFX_PASSWORD } from "../../../../../test/fiscal-cert";
import { readPfx } from "../certificate";
import { dvChave } from "./chave-acesso";
import { createSvrsClient, NFCE_CONSULTA_BA, SVRS_NFCE, svrsHttpsTransport, type SvrsTransport } from "./soap";

const CHAVE = "29261011222333000181650010000000071123456780";
type Req = Parameters<SvrsTransport>[0];
function stub(...answers: ({ status: number; body: string } | "timeout")[]) {
  const calls: Req[] = [];
  const transport: SvrsTransport = async (r) => {
    calls.push(r);
    const a = answers.length > 1 ? answers.shift()! : answers[0];
    if (a === "timeout") throw new Error("tempo esgotado (30 s)");
    return a;
  };
  return { calls, transport };
}
const soap = (inner: string) => `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg>${inner}</nfeResultMsg></soap:Body></soap:Envelope>`;
const PROT = (cStat: string, xMotivo: string) => `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><chNFe>${CHAVE}</chNFe><dhRecbto>2026-10-15T15:00:03-03:00</dhRecbto><nProt>329260000124985</nProt><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo></infProt></protNFe>`;
const RET = (inner: string) => soap(`<retEnviNFe versao="4.00"><tpAmb>2</tpAmb><cStat>104</cStat><xMotivo>Lote processado</xMotivo>${inner}</retEnviNFe>`);

it("a chave dos testes tem o DV certo", () => { expect(dvChave(CHAVE.slice(0, 43))).toBe(Number(CHAVE.at(-1))); });

it("endereços conferidos (SVRS atende a NFC-e da BA; QR Code e consulta da SEFAZ-BA)", () => {
  expect(SVRS_NFCE.teste.autorizacao).toBe("https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx");
  expect(SVRS_NFCE.producao.autorizacao).toBe("https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx");
  expect(SVRS_NFCE.teste.evento).toBe("https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx");
  expect(SVRS_NFCE.producao.consulta).toBe("https://nfce.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx");
  expect(NFCE_CONSULTA_BA.teste).toEqual({ urlQrCode: "http://hnfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx", urlChave: "http://hinternet.sefaz.ba.gov.br/nfce/consulta" });
  expect(NFCE_CONSULTA_BA.producao).toEqual({ urlQrCode: "http://nfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx", urlChave: "http://www.sefaz.ba.gov.br/nfce/consulta" });
});

it("transporte real desligado nos testes (nunca fala com a SVRS)", () => {
  const cert = readPfx(makeTestPfx(), TEST_PFX_PASSWORD);
  expect(() => svrsHttpsTransport(cert)).toThrow("Transporte real desligado nos testes.");
  expect(() => createSvrsClient({ environment: "teste", cert })).toThrow("Transporte real desligado nos testes.");
});

describe("autorização (NFeAutorizacao4, síncrona)", () => {
  it("cStat 100 DENTRO do protNFe é autorizada (o 104 do lote não é autorização)", async () => {
    const st = stub({ status: 200, body: RET(PROT("100", "Autorizado o uso da NF-e")) });
    const r = await createSvrsClient({ environment: "teste", transport: st.transport }).autorizar("<NFe>x</NFe>", "7");
    expect(r).toMatchObject({ kind: "autorizada", nProt: "329260000124985", dhRecbto: "2026-10-15T15:00:03-03:00" });
    expect(r.kind === "autorizada" && r.protNFe).toContain("<cStat>100</cStat>");
    expect(st.calls[0].url).toBe(SVRS_NFCE.teste.autorizacao);
    expect(st.calls[0].action).toBe("http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote");
    expect(st.calls[0].body).toContain(`<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4"><enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><idLote>7</idLote><indSinc>1</indSinc><NFe>x</NFe></enviNFe></nfeDadosMsg>`);
  });
  it("recusa da nota (protNFe) ou do lote vira rejeitada com o código", async () => {
    const a = await createSvrsClient({ environment: "teste", transport: stub({ status: 200, body: RET(PROT("778", "Informado NCM inexistente")) }).transport }).autorizar("<NFe/>", "1");
    expect(a).toMatchObject({ kind: "rejeitada", reason: "Informado NCM inexistente (cStat 778)" });
    const b = await createSvrsClient({ environment: "teste", transport: stub({ status: 200, body: soap("<retEnviNFe><cStat>225</cStat><xMotivo>Falha no Schema XML</xMotivo></retEnviNFe>") }).transport }).autorizar("<NFe/>", "1");
    expect(b).toMatchObject({ kind: "rejeitada", reason: "Falha no Schema XML (cStat 225)" });
  });
  it("SEFAZ fora (108/109), sem cStat, 204 (já recebida) ou sem rede: falha (o sistema confere antes de reenviar)", async () => {
    for (const body of [soap("<retEnviNFe><cStat>108</cStat><xMotivo>Servico Paralisado Momentaneamente</xMotivo></retEnviNFe>"), "<html>erro</html>", RET(PROT("204", "Duplicidade de NF-e"))]) {
      const r = await createSvrsClient({ environment: "teste", transport: stub({ status: 200, body }).transport }).autorizar("<NFe/>", "1");
      expect(r.kind).toBe("falha");
    }
    expect(await createSvrsClient({ environment: "teste", transport: stub("timeout").transport }).autorizar("<NFe/>", "1")).toEqual({ kind: "falha", error: "Sem resposta da SEFAZ: tempo esgotado (30 s)" });
  });
});

describe("consulta pela chave (NFeConsultaProtocolo4)", () => {
  it("100: existe, com o protocolo; 217: não existe; 108: falha", async () => {
    const st = stub(
      { status: 200, body: soap(`<retConsSitNFe versao="4.00"><tpAmb>2</tpAmb><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo>${PROT("100", "Autorizado o uso da NF-e")}</retConsSitNFe>`) },
      { status: 200, body: soap("<retConsSitNFe><cStat>217</cStat><xMotivo>NF-e nao consta na base de dados da SEFAZ</xMotivo></retConsSitNFe>") },
      { status: 200, body: soap("<retConsSitNFe><cStat>108</cStat><xMotivo>Servico Paralisado</xMotivo></retConsSitNFe>") },
    );
    const c = createSvrsClient({ environment: "producao", transport: st.transport });
    expect(await c.consultar(CHAVE)).toMatchObject({ kind: "existe", nProt: "329260000124985", dhRecbto: "2026-10-15T15:00:03-03:00" });
    expect(await c.consultar(CHAVE)).toEqual({ kind: "nao_existe" });
    expect((await c.consultar(CHAVE)).kind).toBe("falha");
    expect(st.calls[0].url).toBe(SVRS_NFCE.producao.consulta);
    expect(st.calls[0].action).toBe("http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4/nfeConsultaNF");
    expect(st.calls[0].body).toContain(`<consSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><tpAmb>1</tpAmb><xServ>CONSULTAR</xServ><chNFe>${CHAVE}</chNFe></consSitNFe>`);
    expect(await c.consultar("123")).toEqual({ kind: "falha", error: "Chave de acesso inválida." });
    // 101/151/155: saiu e foi cancelada fora do CRM.
    const canc = stub({ status: 200, body: soap("<retConsSitNFe><cStat>101</cStat><xMotivo>Cancelamento de NF-e homologado</xMotivo></retConsSitNFe>") });
    expect(await createSvrsClient({ environment: "teste", transport: canc.transport }).consultar(CHAVE)).toMatchObject({ kind: "cancelada", cStat: "101" });
  });
});

describe("cancelamento (NFeRecepcaoEvento4, evento 110111)", () => {
  it("135 ou 155: cancelada; 501: frase do prazo com o código", async () => {
    const ok = stub({ status: 200, body: soap(`<retEnvEvento><cStat>128</cStat><retEvento versao="1.00"><infEvento><cStat>135</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo><nProt>329260000200001</nProt></infEvento></retEvento></retEnvEvento>`) });
    const r = await createSvrsClient({ environment: "teste", transport: ok.transport }).cancelar("<evento/>");
    expect(r).toMatchObject({ ok: true });
    expect(ok.calls[0].url).toBe(SVRS_NFCE.teste.evento);
    expect(ok.calls[0].action).toBe("http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento");
    expect(ok.calls[0].body).toContain("<envEvento xmlns=\"http://www.portalfiscal.inf.br/nfe\" versao=\"1.00\"><idLote>");
    const no = stub({ status: 200, body: soap(`<retEnvEvento><cStat>128</cStat><retEvento><infEvento><cStat>501</cStat><xMotivo>Prazo de cancelamento superior ao previsto na Legislacao</xMotivo></infEvento></retEvento></retEnvEvento>`) });
    expect(await createSvrsClient({ environment: "teste", transport: no.transport }).cancelar("<evento/>"))
      .toEqual({ ok: false, reason: "O prazo legal para cancelar esta nota já passou. (SEFAZ 501: Prazo de cancelamento superior ao previsto na Legislacao)" });
  });
});
