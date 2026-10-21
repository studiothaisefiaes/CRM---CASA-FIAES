import { describe, expect, it } from "vitest";
import {
  DEFAULT_FISCAL_EMPRESA, DEFAULT_FISCAL_REGRAS, certExpiryWarning, fillFiscalText, isFiscalModo, readFiscalEmpresa, readFiscalRegras, unknownFiscalVars,
} from "./fiscal-settings";

describe("empresa fiscal", () => {
  it("lixo vira o padrão; só o que é válido passa", () => {
    expect(readFiscalEmpresa(null)).toEqual(DEFAULT_FISCAL_EMPRESA);
    expect(readFiscalEmpresa("x")).toEqual(DEFAULT_FISCAL_EMPRESA);
    const e = readFiscalEmpresa({ cnpj: "11.222.333/0001-81", regime: "simples", aliquotaSimplesBp: 600, serieDps: 0, codigoMunicipio: "1", cTribNacPadrao: "abc", emitirAoFechar: "sim",
      endereco: { logradouro: "Rua A", numero: "10", bairro: "Pituba", cep: "40000-000" } });
    expect(e.cnpj).toBe("11222333000181");
    expect(e.regime).toBe("simples");
    expect(e.aliquotaSimplesBp).toBe(600);
    expect(e.serieDps).toBe(1);
    expect(e.codigoMunicipio).toBe("2927408");
    expect(e.cTribNacPadrao).toBe("060101");
    expect(e.emitirAoFechar).toBe(false);
    expect(e.endereco).toEqual({ logradouro: "Rua A", numero: "10", bairro: "Pituba", cep: "40000000" });
    expect(readFiscalEmpresa({ endereco: { logradouro: "Rua A" } }).endereco).toBeNull();
    expect(DEFAULT_FISCAL_EMPRESA.aliquotaIssBp).toBeNull();
    expect(readFiscalEmpresa({ aliquotaIssBp: 300 }).aliquotaIssBp).toBe(300);
    for (const v of [199, 501, 2.5, "300", null]) expect(readFiscalEmpresa({ aliquotaIssBp: v }).aliquotaIssBp).toBeNull();
  });
  it("padrões do plano; NBS fica vazio (o sugerido é só sugestão)", () => {
    expect(DEFAULT_FISCAL_EMPRESA).toMatchObject({ cTribNacPadrao: "060101", nbsPadrao: null, serieDps: 1, serieNfce: 1, emitirAoFechar: false, codigoMunicipio: "2927408" });
  });
  it("chave: três estados", () => {
    expect(["desligada", "teste", "producao"].every(isFiscalModo)).toBe(true);
    expect(isFiscalModo("ligada")).toBe(false);
  });
});

describe("regras fiscais", () => {
  it("padrão e leitura tolerante (fora da faixa volta ao padrão)", () => {
    expect(readFiscalRegras(undefined)).toEqual(DEFAULT_FISCAL_REGRAS);
    expect(DEFAULT_FISCAL_REGRAS).toMatchObject({ rascunhoNaComanda: true, tentativasMax: 10, esperaMaxMin: 30, certAvisoDias: 30, nfceCancelarAteMin: 30, assinaturaNfse: "sha1", informarAliquotaNaDps: false });
    const r = readFiscalRegras({ tentativasMax: 99, esperaMaxMin: 45, certAvisoDias: 0, nfceCancelarAteMin: 60, assinaturaNfse: "md5", textos: { servicos: "  ", parceria: "x {cota_salao}" } });
    expect(r.tentativasMax).toBe(10);
    expect(r.esperaMaxMin).toBe(45);
    expect(r.certAvisoDias).toBe(30);
    expect(r.nfceCancelarAteMin).toBe(60);
    expect(r.assinaturaNfse).toBe("sha1");
    expect(r.textos.servicos).toBe(DEFAULT_FISCAL_REGRAS.textos.servicos);
    expect(r.textos.parceria).toBe("x {cota_salao}");
  });
  it("o texto padrão gera exatamente o texto do plano", () => {
    const t = DEFAULT_FISCAL_REGRAS.textos;
    const cotas = [
      fillFiscalText(t.cotaParceira, { razao_social: "Ana Silva ME", cnpj: "11.222.333/0001-81", valor: "R$ 40,00" }),
      fillFiscalText(t.cotaParceira, { razao_social: "Bia Lima ME", cnpj: "44.555.666/0001-00", valor: "R$ 20,00" }),
    ];
    const texto = fillFiscalText(t.servicos, { servicos: "Corte, Hidratação" }) + fillFiscalText(t.parceria, { cota_salao: "R$ 30,00", cotas_parceiras: cotas.join("; ") });
    expect(texto).toBe("Serviços de beleza: Corte, Hidratação. Salão-parceiro (Lei 13.352/2016): cota-parte do salão R$ 30,00; cota-parte de Ana Silva ME (CNPJ 11.222.333/0001-81) R$ 40,00; cota-parte de Bia Lima ME (CNPJ 44.555.666/0001-00) R$ 20,00.");
  });
  it("variável desconhecida é achada", () => {
    expect(unknownFiscalVars("servicos", "Feito: {servicos} {cnpj}")).toEqual(["cnpj"]);
    expect(unknownFiscalVars("cotaParceira", "{razao_social} {cnpj} {valor}")).toEqual([]);
  });
});

describe("aviso de validade do certificado", () => {
  const hoje = new Date("2026-10-18T12:00:00Z");
  it("avisa quando faltam menos dias que o configurado", () => {
    const vence = new Date("2026-11-07T12:00:00Z"); // 20 dias
    expect(certExpiryWarning(vence, 30, hoje)).toBe("Certificado vence em 20 dias");
    expect(certExpiryWarning(vence, 15, hoje)).toBeNull();
    expect(certExpiryWarning(null, 30, hoje)).toBeNull();
    expect(certExpiryWarning(new Date("2026-10-19T12:00:00Z"), 30, hoje)).toBe("Certificado vence em 1 dia");
  });
});
