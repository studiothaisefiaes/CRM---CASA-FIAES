import { describe, expect, it } from "vitest";
import { FUNCOES, fillTexto, resolveFuncao, validateFuncaoPatch, type FuncaoDef } from "./funcoes";

const EX: FuncaoDef = {
  key: "exemplo", label: "Exemplo", description: "Função de exemplo.", enviaParaCliente: true, padraoLigada: false,
  params: [{ key: "horas", label: "Horas de espera", unit: "horas", min: 1, max: 48, default: 24 }],
  textos: [{ key: "aviso", label: "Aviso", vars: ["nome", "setor"], default: "Oi, {nome}! Setor {setor}." }],
};

describe("resolveFuncao", () => {
  it("sem nada salvo vale o padrão", () => {
    expect(resolveFuncao(EX, {})).toEqual({ on: false, params: { horas: 24 }, textos: { aviso: "Oi, {nome}! Setor {setor}." } });
  });
  it("o estado salvo sobrescreve", () => {
    const r = resolveFuncao(EX, { exemplo: { on: true, params: { horas: 5 }, textos: { aviso: "Olá {nome}" } } });
    expect(r).toEqual({ on: true, params: { horas: 5 }, textos: { aviso: "Olá {nome}" } });
  });
  it("estado de outra função ou campo desconhecido é ignorado", () => {
    expect(resolveFuncao(EX, { outra: { on: true }, exemplo: { params: { lixo: 3 } } }).params).toEqual({ horas: 24 });
  });
});

describe("validateFuncaoPatch", () => {
  it("aceita um patch válido", () => {
    expect(validateFuncaoPatch(EX, { on: true, params: { horas: 12 }, textos: { aviso: "Oi {nome}" } })).toEqual({ on: true, params: { horas: 12 }, textos: { aviso: "Oi {nome}" } });
  });
  it("número fora da faixa", () => {
    expect(() => validateFuncaoPatch(EX, { params: { horas: 99 } })).toThrow("Horas de espera: use um número de 1 a 48.");
    expect(() => validateFuncaoPatch(EX, { params: { horas: "x" } })).toThrow("Horas de espera: use um número de 1 a 48.");
  });
  it("texto vazio", () => {
    expect(() => validateFuncaoPatch(EX, { textos: { aviso: "   " } })).toThrow("Aviso: escreva o texto ou use o sugerido.");
  });
  it("variável inexistente", () => {
    expect(() => validateFuncaoPatch(EX, { textos: { aviso: "Oi {apelido}" } })).toThrow("Aviso: a variável {apelido} não existe aqui. Use: {nome}, {setor}.");
  });
  it("null volta ao sugerido", () => {
    expect(validateFuncaoPatch(EX, { textos: { aviso: null } })).toEqual({ textos: { aviso: null } });
  });
  it("recusa param, texto e campo desconhecidos", () => {
    expect(() => validateFuncaoPatch(EX, { params: { nada: 1 } })).toThrow();
    expect(() => validateFuncaoPatch(EX, { textos: { nada: "x" } })).toThrow();
    expect(() => validateFuncaoPatch(EX, { ligado: true })).toThrow();
    expect(() => validateFuncaoPatch(EX, "x")).toThrow();
  });
});

describe("fillTexto", () => {
  it("troca as variáveis e deixa a desconhecida como está", () => {
    expect(fillTexto("Oi, {nome}! {setor} {x}", { nome: "Ana", setor: "Recepção" })).toBe("Oi, Ana! Recepção {x}");
  });
});

describe("registro FUNCOES (vale para as entradas das próximas tasks)", () => {
  it("chaves únicas", () => { const ks = FUNCOES.map((f) => f.key); expect(new Set(ks).size).toBe(ks.length); });
  it("quem envia para a cliente nasce desligada", () => {
    for (const f of FUNCOES) if (f.enviaParaCliente) expect(f.padraoLigada, f.key).toBe(false);
  });
  it("padrão de cada número dentro de min/max", () => {
    for (const f of FUNCOES) for (const p of f.params ?? []) { expect(p.default, `${f.key}.${p.key}`).toBeGreaterThanOrEqual(p.min); expect(p.default, `${f.key}.${p.key}`).toBeLessThanOrEqual(p.max); }
  });
  it("padrão de cada texto só usa as próprias variáveis", () => {
    for (const f of FUNCOES) for (const t of f.textos ?? []) {
      for (const m of t.default.matchAll(/\{(\w+)\}/g)) expect(t.vars, `${f.key}.${t.key}`).toContain(m[1]);
    }
  });
  it("o exemplo do teste também cumpre as regras", () => {
    expect(EX.enviaParaCliente && !EX.padraoLigada).toBe(true);
  });
});
