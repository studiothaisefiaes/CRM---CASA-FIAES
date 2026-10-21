import { describe, expect, it } from "vitest";
import { DEFAULT_FISCAL_EMPRESA, type FiscalEmpresa } from "@/lib/fiscal-settings";
import { dvChave } from "./chave-acesso";
import { buildNfceCancelEventXml, buildNfceXml, gtinOrSem, prorate, tPagOf, type NfceInput } from "./xml";

const EMPRESA: FiscalEmpresa = {
  ...DEFAULT_FISCAL_EMPRESA, cnpj: "11222333000181", razaoSocial: "Casa Fiaes Ltda", inscricaoEstadual: "123456789", inscricaoMunicipal: "123456", regime: "simples",
  endereco: { logradouro: "Rua das Flores", numero: "10", bairro: "Pituba", cep: "41810000" },
};
const ITEM = { productId: "a1b2c3d4-0000-4000-8000-000000000001", name: "Shampoo & Condicionador", ncm: "33051000", cfop: "5102", csosn: "102", unit: "UN", barcode: null, qty: 1 };
const input = (o: Partial<NfceInput> = {}): NfceInput => ({
  empresa: EMPRESA, environment: "teste", series: 1, number: 7, emittedAt: new Date("2026-10-15T18:00:00Z"), cNF: "12345678",
  itens: [{ ...ITEM, netCents: 4590 }, { ...ITEM, productId: "a1b2c3d4-0000-4000-8000-000000000002", name: "Máscara", qty: 2, netCents: 7000 }],
  pagamentos: [{ method: "pix", cents: 11590, brand: null }], consumidor: { cpf: null, nome: null }, ...o,
});
const tag = (xml: string, t: string) => [...xml.matchAll(new RegExp(`<${t}>([^<]*)</${t}>`, "g"))].map((m) => m[1]);

describe("prorate (maiores restos)", () => {
  it("3 formas que somam exatamente o total dos produtos", () => {
    const r = prorate(9999, [{ key: "pix", cents: 5000 }, { key: "credito", cents: 3000 }, { key: "dinheiro", cents: 2000 }]);
    expect([...r.entries()]).toEqual([["pix", 4999], ["credito", 3000], ["dinheiro", 2000]]);
    expect([...r.values()].reduce((a, b) => a + b, 0)).toBe(9999);
    const q = prorate(100, [{ key: "a", cents: 1 }, { key: "b", cents: 1 }, { key: "c", cents: 1 }]);
    expect([...q.values()].reduce((a, b) => a + b, 0)).toBe(100);
    expect([...q.values()].sort()).toEqual([33, 33, 34]);
  });
  it("sem peso ou sem total: tudo zero", () => {
    expect([...prorate(500, [{ key: "a", cents: 0 }]).values()]).toEqual([0]);
    expect([...prorate(0, [{ key: "a", cents: 10 }]).values()]).toEqual([0]);
  });
});

it("tPagOf: dinheiro 01, crédito 03, débito 04, crédito da cliente 05, pix 17, cortesia 90, outra 99", () => {
  expect((["dinheiro", "credito", "debito", "credito_cliente", "pix", "cortesia", "outra"] as const).map(tPagOf)).toEqual(["01", "03", "04", "05", "17", "90", "99"]);
});

it("GTIN: só com o dígito verificador certo; senão SEM GTIN", () => {
  expect(gtinOrSem("7891234567895")).toBe("7891234567895");
  expect(gtinOrSem("7891234567890")).toBe("SEM GTIN");
  expect(gtinOrSem("abc")).toBe("SEM GTIN");
  expect(gtinOrSem(null)).toBe("SEM GTIN");
});

describe("XML da NFC-e (modelo 65)", () => {
  it("homologação: tpAmb 2, NCM, CFOP 5102, CSOSN 102 e vNF igual à soma dos produtos", () => {
    const r = buildNfceXml(input());
    expect(r.totalCents).toBe(11590);
    expect(r.id).toBe(`NFe${r.chave}`);
    expect(r.xml).toContain(`<infNFe Id="${r.id}" versao="4.00">`);
    expect(r.xml.startsWith("<NFe xmlns=\"http://www.portalfiscal.inf.br/nfe\">")).toBe(true);
    expect(tag(r.xml, "tpAmb")).toEqual(["2"]);
    expect(tag(r.xml, "mod")).toEqual(["65"]);
    expect(tag(r.xml, "NCM")).toEqual(["33051000", "33051000"]);
    expect(tag(r.xml, "CFOP")).toEqual(["5102", "5102"]);
    expect(tag(r.xml, "CSOSN")).toEqual(["102", "102"]);
    expect(tag(r.xml, "vNF")).toEqual(["115.90"]);
    expect(tag(r.xml, "vProd")).toEqual(["45.90", "70.00", "115.90"]);
    expect(tag(r.xml, "qCom")).toEqual(["1.0000", "2.0000"]);
    expect(tag(r.xml, "vUnCom")).toEqual(["45.9000000000", "35.0000000000"]);
    expect(tag(r.xml, "CRT")).toEqual(["1"]);
    expect(tag(r.xml, "IE")).toEqual(["123456789"]);
    expect(tag(r.xml, "cMunFG")).toEqual(["2927408"]);
    expect(tag(r.xml, "dhEmi")).toEqual(["2026-10-15T15:00:00-03:00"]);
    // cStat 373: em homologação, o xProd do PRIMEIRO item é exatamente o aviso; os outros ficam com o nome.
    expect(tag(r.xml, "xProd")).toEqual(["NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL", "Máscara"]);
    // Chave: BA (29), AAMM de Salvador, CNPJ, modelo 65, série, número, tpEmis 1, cNF e o DV.
    expect(r.chave).toMatch(/^292610112223330001816500100000000711234567[0-9]{2}$/);
    expect(Number(r.chave.at(-1))).toBe(dvChave(r.chave.slice(0, 43)));
    expect(tag(r.xml, "cDV")).toEqual([r.chave.at(-1)]);
    expect(r.xml).not.toContain("<dest>");
  });

  it("produção: tpAmb 1, xProd com o nome do produto escapado; CFOP e CSOSN vêm do cadastro", () => {
    const r = buildNfceXml(input({ environment: "producao", itens: [{ ...ITEM, cfop: "5405", csosn: "500", unit: "FR", barcode: "7891234567895", netCents: 4590 }], pagamentos: [{ method: "dinheiro", cents: 4590, brand: null }] }));
    expect(tag(r.xml, "tpAmb")).toEqual(["1"]);
    expect(r.xml).toContain("<xProd>Shampoo &amp; Condicionador</xProd>");
    expect(tag(r.xml, "CFOP")).toEqual(["5405"]);
    expect(r.xml).toContain("<ICMSSN500><orig>0</orig><CSOSN>500</CSOSN></ICMSSN500>");
    expect(tag(r.xml, "uCom")).toEqual(["FR"]);
    expect(tag(r.xml, "cEAN")).toEqual(["7891234567895"]);
    expect(tag(r.xml, "cEANTrib")).toEqual(["7891234567895"]);
  });

  it("<pag>: cartão com tpIntegra 2 e tBand; Pix com tpIntegra 2 sem bandeira; outra com xPag; soma igual ao vNF", () => {
    const r = buildNfceXml(input({
      pagamentos: [
        { method: "credito", cents: 5000, brand: "visa" }, { method: "debito", cents: 3000, brand: "elo" }, { method: "pix", cents: 2000, brand: null },
        { method: "dinheiro", cents: 1000, brand: null }, { method: "outra", cents: 590, brand: null },
      ],
    }));
    const pag = r.xml.match(/<pag>.*<\/pag>/)![0];
    expect(pag).toContain("<detPag><indPag>0</indPag><tPag>03</tPag><vPag>50.00</vPag><card><tpIntegra>2</tpIntegra><tBand>01</tBand></card></detPag>");
    expect(pag).toContain("<detPag><indPag>0</indPag><tPag>04</tPag><vPag>30.00</vPag><card><tpIntegra>2</tpIntegra><tBand>06</tBand></card></detPag>");
    expect(pag).toContain("<detPag><indPag>0</indPag><tPag>17</tPag><vPag>20.00</vPag><card><tpIntegra>2</tpIntegra></card></detPag>");
    expect(pag).toContain("<detPag><indPag>0</indPag><tPag>01</tPag><vPag>10.00</vPag></detPag>");
    expect(pag).toContain("<detPag><indPag>0</indPag><tPag>99</tPag><xPag>Outra forma</xPag><vPag>5.90</vPag></detPag>");
    // Bandeira fora da tabela confirmada (Alelo, VR…) cai em 99 Outros.
    const b = buildNfceXml(input({ pagamentos: [{ method: "credito", cents: 11590, brand: "alelo" }] }));
    expect(b.xml).toContain("<tBand>99</tBand>");
    expect(() => buildNfceXml(input({ pagamentos: [{ method: "pix", cents: 100, brand: null }] }))).toThrow("As formas de pagamento não fecham com o valor dos produtos.");
  });

  it("CPF na nota vira <dest> com indIEDest 9", () => {
    const r = buildNfceXml(input({ consumidor: { cpf: "11144477735", nome: "Paula" } }));
    expect(r.xml).toContain("<dest><CPF>11144477735</CPF><xNome>Paula</xNome><indIEDest>9</indIEDest></dest>");
    expect(buildNfceXml(input({ consumidor: { cpf: "11144477735", nome: null } })).xml).toContain("<xNome>CONSUMIDOR</xNome>");
  });

  it("recusa com frase o que a SEFAZ recusaria", () => {
    expect(() => buildNfceXml(input({ empresa: { ...EMPRESA, inscricaoEstadual: null } }))).toThrow("Preencha a inscrição estadual da Casa em Configurações › Nota fiscal.");
    expect(() => buildNfceXml(input({ empresa: { ...EMPRESA, endereco: null } }))).toThrow("Preencha o endereço da Casa em Configurações › Nota fiscal.");
    expect(() => buildNfceXml(input({ empresa: { ...EMPRESA, regime: "presumido" } }))).toThrow("A NFC-e do CRM só sai no Simples Nacional.");
    expect(() => buildNfceXml(input({ itens: [{ ...ITEM, csosn: "201", netCents: 11590 }] }))).toThrow("O CSOSN 201 do produto Shampoo & Condicionador ainda não sai na NFC-e do CRM: use 102, 103, 300, 400, 500 ou 900.");
    expect(() => buildNfceXml(input({ itens: [] }))).toThrow("Essa comanda não tem produto para nota.");
  });

  it("evento de cancelamento 110111 (sem assinatura)", () => {
    const chave = "29261011222333000181650010000000071123456780";
    const e = buildNfceCancelEventXml({ chave, protocolo: "329260000124985", reason: "  Produto lançado   errado na comanda ", environment: "teste", at: new Date("2026-10-15T18:10:00Z") });
    expect(e.id).toBe(`ID110111${chave}01`);
    expect(e.xml).toBe(`<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><infEvento Id="${e.id}"><cOrgao>29</cOrgao><tpAmb>2</tpAmb><CNPJ>11222333000181</CNPJ>`
      + `<chNFe>${chave}</chNFe><dhEvento>2026-10-15T15:10:00-03:00</dhEvento><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento>`
      + `<detEvento versao="1.00"><descEvento>Cancelamento</descEvento><nProt>329260000124985</nProt><xJust>Produto lançado errado na comanda</xJust></detEvento></infEvento></evento>`);
    expect(() => buildNfceCancelEventXml({ chave, protocolo: "329260000124985", reason: "curto", environment: "teste", at: new Date() })).toThrow("Escreva o motivo do cancelamento (pelo menos 15 letras).");
  });
});
