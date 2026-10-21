import { describe, expect, it } from "vitest";
import { menuStep, parseMenuChoice, welcomeText, type WelcomeConfig } from "./welcome-menu-flow";

const opts = [{ label: "Agendar horário" }, { label: "Método Fiaes®" }, { label: "Saber preços" }];

describe("parseMenuChoice", () => {
  it.each([["2", 1], [" 2 ", 1], ["2.", 1], ["2)", 1], ["2️⃣", 1], ["opção 2", 1], ["Opção 2", 1], ["opcao 2", 1], ["Método Fiaes", 1], ["metodo fiaes®", 1], ["1", 0], ["3", 2]])("'%s' escolhe a opção %i", (t, i) => {
    expect(parseMenuChoice(t, opts)).toBe(i);
  });
  it.each(["tenho 2 filhas", "dois horários", "7", "0", "", "22", "Oi, boa tarde! Queria saber o valor da escova", "quero o 2"])("'%s' não é escolha", (t) => {
    expect(parseMenuChoice(t, opts)).toBeNull();
  });
});

const CFG: WelcomeConfig = {
  enabled: true,
  intro: "Olá! Responda com o número:",
  options: [
    { label: "Agendar horário", tag: "Quer agendar" },
    { label: "Método Fiaes®", submenu: { intro: "Sobre o Método Fiaes®:", options: [{ label: "Primeira avaliação", passTo: { team: "t1" } }, { label: "Já sou cliente", reply: { text: "Que bom te ver 💛" } }] } },
    { label: "Saber preços", reply: { text: "Segue a tabela:", fileId: "f1" } },
  ],
};

describe("menuStep", () => {
  it("opção com submenu devolve o texto do submenu numerado; a escolha no submenu devolve a opção de dentro", () => {
    const sub = menuStep(CFG, [], "2");
    expect(sub).toEqual({ kind: "submenu", path: [1], text: "Sobre o Método Fiaes®:\n\n1. Primeira avaliação\n2. Já sou cliente" });
    const inside = menuStep(CFG, [1], "1");
    expect(inside).toEqual({ kind: "escolheu", path: [1, 0], option: CFG.options[1].submenu!.options[0] });
    // "1" no submenu não é a opção 1 do menu de cima
    expect(inside.kind === "escolheu" && inside.option.label).toBe("Primeira avaliação");
  });
  it("opção sem submenu: escolheu; fora das opções: não entendi", () => {
    expect(menuStep(CFG, [], "3")).toEqual({ kind: "escolheu", path: [2], option: CFG.options[2] });
    expect(menuStep(CFG, [], "tenho 2 filhas")).toEqual({ kind: "nao_entendi" });
    expect(menuStep(CFG, [1], "3")).toEqual({ kind: "nao_entendi" });
    expect(menuStep(CFG, [0], "1")).toEqual({ kind: "nao_entendi" }); // a opção 1 não tem submenu
    expect(menuStep(CFG, [1, 0], "1")).toEqual({ kind: "nao_entendi" }); // não existe 3º nível
  });
  it("formato antigo { label, tag } continua valendo", () => {
    const old: WelcomeConfig = { enabled: true, intro: "Oi", options: [{ label: "Agendar", tag: "Quer agendar" }, { label: "Preços", tag: null }] };
    expect(menuStep(old, [], "1")).toEqual({ kind: "escolheu", path: [0], option: old.options[0] });
    expect(welcomeText(old)).toBe("Oi\n\n1. Agendar\n2. Preços");
  });
});
