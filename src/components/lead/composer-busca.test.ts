import { describe, expect, it } from "vitest";
import { searchReplies } from "@/lib/reply-search";

const r = (label: string, body = "", folder: string | null = null) => ({ label, body, folder });
const list = [r("1-curso-mf", "Quer saber do curso…", "Curso"), r("2-curso-mf", "O investimento…", "Curso"), r("confirma", "Confirmando seu horário"), r("endereco", "Estamos na Alameda das Seringueiras, curso de 2 dias")];

describe("busca do / nas respostas prontas (20/10)", () => {
  it("hífen vale como espaço e maiúscula não importa: 'curso mf' e 'MF' acham as do curso", () => {
    expect(searchReplies(list, "curso mf").map((q) => q.label)).toEqual(["1-curso-mf", "2-curso-mf"]);
    expect(searchReplies(list, "MF").map((q) => q.label)).toEqual(["1-curso-mf", "2-curso-mf"]);
  });
  it("sem acento; o atalho vem antes de quem só tem a palavra no texto", () => {
    expect(searchReplies(list, "curso").map((q) => q.label)).toEqual(["1-curso-mf", "2-curso-mf", "endereco"]);
    expect(searchReplies(list, "horario").map((q) => q.label)).toEqual(["confirma"]);
  });
  it("vazio lista todas; mostra até 30 (antes eram 6)", () => {
    const many = Array.from({ length: 40 }, (_, i) => r(`r${i}`));
    expect(searchReplies(many, "")).toHaveLength(30);
    expect(searchReplies(many, "r")).toHaveLength(30);
  });
});
