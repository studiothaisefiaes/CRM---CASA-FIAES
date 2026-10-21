import { describe, expect, it } from "vitest";
import { DEFAULT_FISCAL_EMPRESA, type FiscalEmpresa } from "@/lib/fiscal-settings";
import type { NfseDraft } from "./draft";
import { buildCancelEventXml, buildDpsXml, dpsId, type DpsInput } from "./dps-xml";

const empresa: FiscalEmpresa = {
  ...DEFAULT_FISCAL_EMPRESA, cnpj: "11222333000181", razaoSocial: "Casa Fiaes Ltda", inscricaoMunicipal: "123456", regime: "simples", aliquotaSimplesBp: 600, aliquotaIssBp: 300,
};
const draft: NfseDraft = {
  comandaId: "c1", comandaNumber: 7, day: "2026-11-03", tomador: { cpf: "52998224725", nome: "Maria Souza" },
  lines: [{ itemId: "i1", label: "Corte", netCents: 12150, professional: "Ana", partner: null, cTribNac: "060101", nbs: null }],
  totalCents: 12150, salaoCents: 12150, parceiras: [], discriminacao: "Serviços de beleza: Corte.", parceirasSemCnpj: [], avisos: [],
};
const base: DpsInput = { draft, empresa, regras: { informarAliquotaNaDps: false }, environment: "teste", series: 1, number: 42, emittedAt: new Date("2026-11-03T13:00:00Z") };
const ID = "DPS292740821122233300018100001000000000000042";

describe("Id da DPS", () => {
  it("tem 45 caracteres e o formato fixo", () => {
    expect(dpsId("11222333000181", 1, 42)).toBe(ID);
    expect(ID).toHaveLength(45);
    expect(dpsId("11.222.333/0001-81", 49999, 999_999_999_999_999)).toBe("DPS2927408211222333000181" + "49999" + "999999999999999");
  });
  it("recusa CNPJ, série e número fora do formato", () => {
    expect(() => dpsId("123", 1, 1)).toThrow();
    expect(() => dpsId("11222333000181", 0, 1)).toThrow();
    expect(() => dpsId("11222333000181", 1, 0)).toThrow();
    expect(() => dpsId("11222333000181", 1, 1.5)).toThrow();
  });
});

describe("DPS", () => {
  it("leiaute 1.01 completo, na ordem do XSD (Simples ME/EPP, com CPF, sem pAliq)", () => {
    const { xml, id } = buildDpsXml(base);
    expect(id).toBe(ID);
    expect(xml).toBe(
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infDPS Id="${ID}">` +
      `<tpAmb>2</tpAmb><dhEmi>2026-11-03T09:59:00-03:00</dhEmi><verAplic>CasaFiaesCRM-1.0</verAplic><serie>1</serie><nDPS>42</nDPS>` +
      `<dCompet>2026-11-03</dCompet><tpEmit>1</tpEmit><cLocEmi>2927408</cLocEmi>` +
      `<prest><CNPJ>11222333000181</CNPJ><IM>123456</IM><regTrib><opSimpNac>3</opSimpNac><regApTribSN>1</regApTribSN><regEspTrib>0</regEspTrib></regTrib></prest>` +
      `<toma><CPF>52998224725</CPF><xNome>Maria Souza</xNome></toma>` +
      `<serv><locPrest><cLocPrestacao>2927408</cLocPrestacao></locPrest><cServ><cTribNac>060101</cTribNac><xDescServ>Serviços de beleza: Corte.</xDescServ></cServ></serv>` +
      `<valores><vServPrest><vServ>121.50</vServ></vServPrest><trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN></tribMun>` +
      `<totTrib><pTotTribSN>6.00</pTotTribSN></totTrib></trib></valores>` +
      `</infDPS></DPS>`,
    );
  });
  it("produção leva tpAmb 1; centavos com ponto e 2 casas", () => {
    const { xml } = buildDpsXml({ ...base, environment: "producao", draft: { ...draft, totalCents: 100005 } });
    expect(xml).toContain("<tpAmb>1</tpAmb>");
    expect(xml).toContain("<vServ>1000.05</vServ>");
  });
  it("sem CPF a DPS sai sem tomador identificado; CPF sem nome leva 'Consumidor'", () => {
    expect(buildDpsXml({ ...base, draft: { ...draft, tomador: { cpf: null, nome: "Maria" } } }).xml).not.toContain("<toma>");
    expect(buildDpsXml({ ...base, draft: { ...draft, tomador: { cpf: "52998224725", nome: null } } }).xml).toContain("<toma><CPF>52998224725</CPF><xNome>Consumidor</xNome></toma>");
  });
  it("caracteres especiais do texto escapados (&, <, >, aspas)", () => {
    const { xml } = buildDpsXml({ ...base, draft: { ...draft, discriminacao: `Corte & escova <longo> "premium" d'água`, tomador: { cpf: "52998224725", nome: "Ana & Bia <x>" } } });
    expect(xml).toContain("<xDescServ>Corte &amp; escova &lt;longo&gt; &quot;premium&quot; d&apos;água</xDescServ>");
    expect(xml).toContain("<xNome>Ana &amp; Bia &lt;x&gt;</xNome>");
  });
  it("Regra do dono: pAliq só entra com fiscal_regras.informarAliquotaNaDps ligado", () => {
    expect(buildDpsXml(base).xml).not.toContain("<pAliq>");
    const { xml } = buildDpsXml({ ...base, regras: { informarAliquotaNaDps: true } });
    // pAliq é a alíquota do ISS (aliquotaIssBp); o pTotTribSN continua com a alíquota do Simples.
    expect(xml).toContain("<tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN><pAliq>3.00</pAliq></tribMun><totTrib><pTotTribSN>6.00</pTotTribSN></totTrib>");
    expect(() => buildDpsXml({ ...base, regras: { informarAliquotaNaDps: true }, empresa: { ...empresa, aliquotaIssBp: null } }))
      .toThrow("Informe a alíquota do ISS em Configurações › Nota fiscal.");
    expect(buildDpsXml({ ...base, empresa: { ...empresa, aliquotaIssBp: null } }).xml).not.toContain("<pAliq>");
  });
  it("NBS entra quando todas as linhas têm o mesmo; Simples sem alíquota declara indTotTrib 0", () => {
    const { xml } = buildDpsXml({ ...base, draft: { ...draft, lines: [{ ...draft.lines[0], nbs: "126021000" }] }, empresa: { ...empresa, aliquotaSimplesBp: null } });
    expect(xml).toContain("<cServ><cTribNac>060101</cTribNac><xDescServ>Serviços de beleza: Corte.</xDescServ><cNBS>126021000</cNBS></cServ>");
    expect(xml).toContain("<totTrib><indTotTrib>0</indTotTrib></totTrib>");
  });
  it("Lucro presumido: opSimpNac 1, sem regApTribSN", () => {
    const { xml } = buildDpsXml({ ...base, empresa: { ...empresa, regime: "presumido" } });
    expect(xml).toContain("<regTrib><opSimpNac>1</opSimpNac><regEspTrib>0</regEspTrib></regTrib>");
    expect(xml).toContain("<totTrib><indTotTrib>0</indTotTrib></totTrib>");
  });
  it("a folga do relógio não puxa a emissão nem a competência para o dia anterior (00:00:30 de 01/11 em Salvador)", () => {
    const { xml } = buildDpsXml({ ...base, draft: { ...draft, day: "2026-11-01" }, emittedAt: new Date("2026-11-01T03:00:30Z") });
    expect(xml).toContain("<dhEmi>2026-11-01T00:00:00-03:00</dhEmi>");
    expect(xml).toContain("<dCompet>2026-11-01</dCompet>");
  });
  it("competência não passa do dia da emissão", () => {
    expect(buildDpsXml({ ...base, draft: { ...draft, day: "2026-11-01" } }).xml).toContain("<dCompet>2026-11-01</dCompet>");
    expect(buildDpsXml({ ...base, draft: { ...draft, day: "2026-11-05" } }).xml).toContain("<dCompet>2026-11-03</dCompet>");
  });
  it("faltando dado da Casa ou com códigos de serviço diferentes, erro com frase", () => {
    expect(() => buildDpsXml({ ...base, empresa: { ...empresa, cnpj: null } })).toThrow("Preencha o CNPJ da Casa em Configurações › Nota fiscal.");
    expect(() => buildDpsXml({ ...base, empresa: { ...empresa, regime: null } })).toThrow("Escolha o regime tributário em Configurações › Nota fiscal.");
    const outra = { ...draft.lines[0], itemId: "i2", cTribNac: "060201" };
    expect(() => buildDpsXml({ ...base, draft: { ...draft, lines: [draft.lines[0], outra] } }))
      .toThrow("A comanda tem serviços com códigos diferentes (060101, 060201): uma nota só aceita um código.");
    expect(() => buildDpsXml({ ...base, draft: { ...draft, discriminacao: "x".repeat(2001) } })).toThrow("O texto da nota passa de 2000 caracteres.");
  });
});

describe("evento de cancelamento", () => {
  const chave = "2".repeat(50);
  it("pedRegEvento 1.01 com e101101 e Id PRE + chave + 101101 (59 caracteres)", () => {
    const { xml, id } = buildCancelEventXml({ accessKey: chave, cnpj: "11222333000181", environment: "teste", reason: "Erro no valor do serviço", code: "1", emittedAt: new Date("2026-11-03T13:00:00Z") });
    expect(id).toBe(`PRE${chave}101101`);
    expect(id).toHaveLength(59);
    expect(xml).toBe(
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<pedRegEvento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infPedReg Id="${id}">` +
      `<tpAmb>2</tpAmb><verAplic>CasaFiaesCRM-1.0</verAplic><dhEvento>2026-11-03T09:59:00-03:00</dhEvento>` +
      `<CNPJAutor>11222333000181</CNPJAutor><chNFSe>${chave}</chNFSe>` +
      `<e101101><xDesc>Cancelamento de NFS-e</xDesc><cMotivo>1</cMotivo><xMotivo>Erro no valor do serviço</xMotivo></e101101>` +
      `</infPedReg></pedRegEvento>`,
    );
  });
  it("motivo de 15 a 255 caracteres (regra do leiaute, fixa); chave de 50 números", () => {
    const o = { accessKey: chave, cnpj: "11222333000181", environment: "producao" as const, code: "9" as const, emittedAt: new Date() };
    expect(() => buildCancelEventXml({ ...o, reason: "   curto demais " })).toThrow("Escreva o motivo do cancelamento (pelo menos 15 letras).");
    expect(() => buildCancelEventXml({ ...o, reason: "x".repeat(256) })).toThrow("O motivo do cancelamento passa de 255 caracteres.");
    expect(() => buildCancelEventXml({ ...o, accessKey: "123", reason: "Serviço não foi prestado" })).toThrow("Chave de acesso inválida.");
    expect(buildCancelEventXml({ ...o, reason: "Serviço não foi prestado & ok" }).xml).toContain("<tpAmb>1</tpAmb>");
    expect(buildCancelEventXml({ ...o, reason: "Serviço não foi prestado & ok" }).xml).toContain("<cMotivo>9</cMotivo><xMotivo>Serviço não foi prestado &amp; ok</xMotivo>");
  });
});
