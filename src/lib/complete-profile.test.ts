import { describe, expect, it } from "vitest";
import { stripCompleteProfile } from "./complete-profile";
import { displayName } from "./display-name";

// 17/10: 52 contatos com o "(completar cadastro)" do Avec no nome (análise de dados, script 02).
describe("stripCompleteProfile", () => {
  it("tira o sufixo com ou sem parênteses (e sem o de fechar), na mesma regra do script 02", () => {
    expect(stripCompleteProfile("ANA LIMA (COMPLETAR CADASTRO)")).toEqual({ name: "ANA LIMA", note: null, hit: true });
    expect(stripCompleteProfile("Ana Lima (completar cadastro")).toEqual({ name: "Ana Lima", note: null, hit: true });
    expect(stripCompleteProfile("ANA LIMA (COMPLETAR)")).toEqual({ name: "ANA LIMA", note: null, hit: true });
    expect(stripCompleteProfile("ANA LIMA (COMPLETAR CADASTROO)")).toEqual({ name: "ANA LIMA", note: null, hit: true });
    expect(stripCompleteProfile("MARIA SOUZA COMPLETAR CADASTRO")).toEqual({ name: "MARIA SOUZA", note: null, hit: true });
    expect(stripCompleteProfile("MARIA SOUZA COMPLETAR")).toEqual({ name: "MARIA SOUZA", note: null, hit: true });
    expect(stripCompleteProfile("MARIA SOUZA - COMPLETAR CADASTRO ONLINE")).toEqual({ name: "MARIA SOUZA", note: null, hit: true });
  });
  it("o recado entre parênteses vai para a observação", () => {
    expect(stripCompleteProfile("JOANA (MÃE AMIGA DA TAL - COMPLETAR CADASTRO)")).toEqual({ name: "JOANA", note: "MÃE AMIGA DA TAL", hit: true });
  });
  it("não mexe: sem o sufixo, nome que ficaria vazio, 'completar' no meio do nome", () => {
    expect(stripCompleteProfile("Ana Lima")).toEqual({ name: "Ana Lima", note: null, hit: false });
    expect(stripCompleteProfile("(COMPLETAR CADASTRO)")).toEqual({ name: "(COMPLETAR CADASTRO)", note: null, hit: false });
    expect(stripCompleteProfile("ANA COMPLETAR CADASTRO SILVA")).toEqual({ name: "ANA COMPLETAR CADASTRO SILVA", note: null, hit: false });
  });
  it("a tela nunca mostra o sufixo", () => {
    expect(displayName("ANA LIMA (COMPLETAR CADASTRO)")).toBe("Ana Lima");
    expect(displayName("Maria Souza completar")).toBe("Maria Souza");
  });
});
