import { describe, expect, it } from "vitest";
import { decodeCsv, parseChatguruCsv } from "./chatguru-csv";

const CHATS = "﻿Nome;WhatsApp;Link;Data de cadastro;Última mensagem;Tags;CPF\n" +
  "Cliente Teste Um;5571999990011;https://s12.chatguru.app/chats#6512aa;10/05/2025;oi;VIP, Noiva;123.456.789-00\n" +
  "Cliente Teste Dois;(71) 99999-0012;;;tudo bem;;\n" +
  "Sem Número;abc;;;;Promo;\n";

describe("CSV do ChatGuru: leitura", () => {
  it("relatório de chats: nome, número, link, cadastro e etiquetas; CPF sai antes de ler; colunas desconhecidas avisadas", () => {
    const p = parseChatguruCsv(CHATS);
    expect(p.kind).toBe("chats");
    expect(p.total).toBe(3);
    expect(p.rows).toHaveLength(2);
    expect(p.rows[0]).toMatchObject({ line: 2, phone: "+5571999990011", name: "Cliente Teste Um", link: "https://s12.chatguru.app/chats#6512aa", since: "2025-05-10", tags: ["VIP", "Noiva"], note: null });
    expect(p.rows[1]).toMatchObject({ phone: "+5571999990012", tags: [] });
    expect(p.invalid).toEqual([{ line: 4, value: "abc" }]);
    expect(p.removedColumns).toEqual(["CPF"]);
    expect(p.ignoredColumns).toEqual(["Última mensagem"]);
    expect(JSON.stringify(p.rows)).not.toContain("123.456.789-00");
  });
  it("funil: etapa e responsável", () => {
    const p = parseChatguruCsv("Nome,Número,Etapa,Responsável\nCliente Teste Um,5571999990011,Orçamento,SARA\n");
    expect(p.kind).toBe("funil");
    expect(p.rows[0]).toMatchObject({ phone: "+5571999990011", stage: "Orçamento", responsavel: "SARA" });
  });
  it("anotações: data e hora de Salvador, autor e texto", () => {
    const p = parseChatguruCsv("Número;Data;Autor;Anotação\n5571999990011;12/10/2026 14:30;SARA;Cliente pediu orçamento de mega hair\n");
    expect(p.kind).toBe("anotacoes");
    expect(p.rows[0].note).toEqual({ at: "2026-10-12T17:30:00.000Z", author: "SARA", text: "Cliente pediu orçamento de mega hair" });
  });
  it("sem coluna de número: erro claro", () => {
    expect(() => parseChatguruCsv("Nome;Tags\nCliente Teste;VIP\n")).toThrow(/coluna do WhatsApp/);
  });
  it("arquivo salvo no Excel (Windows-1252) sai com acento certo", () => {
    expect(decodeCsv(Buffer.from("Nome;WhatsApp\nJoão Teste;5571999990011\n", "latin1"))).toContain("João Teste");
  });
});
