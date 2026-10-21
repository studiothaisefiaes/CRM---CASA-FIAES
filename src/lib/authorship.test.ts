// src/lib/authorship.test.ts
import { describe, expect, it } from "vitest";
import { conversationWith, firstName, lastMessagePrefix, outMeta, ownerLine, teamShortName } from "./authorship";

describe("nomes de quem atende", () => {
  it("primeiro nome e nome da equipe (assinatura primeiro)", () => {
    expect(firstName("Sara Lima")).toBe("Sara");
    expect(firstName("  ")).toBeNull();
    expect(teamShortName({ name: "Catarina Moura", signature: "CATI" })).toBe("Cati");
    expect(teamShortName({ name: "Joaquim Salles", signature: null })).toBe("Joaquim");
  });
});

describe("outMeta (rodapé do balão da Casa)", () => {
  it("nome e por onde saiu", () => {
    expect(outMeta({ fromPhone: true, sentVia: "celular", sender: "Cati" })).toBe("Cati · pelo celular · ");
    expect(outMeta({ fromPhone: false, sentVia: "crm", sender: "Sara Lima" })).toBe("Sara · ");
    expect(outMeta({ fromPhone: true, sender: null, body: "*MARIA JOSÉ - CASA FIAES:*\nOi" })).toBe("Maria José · pelo celular · ");
    expect(outMeta({ fromPhone: true, sender: null, body: "Oi" })).toBe("pelo celular · ");
    expect(outMeta({ fromPhone: false, sender: null, body: "Lembrete" })).toBe("automática · ");
  });
});

describe("Fila e Quadro", () => {
  it("prefixo da última mensagem: quem escreveu, ou Casa", () => {
    expect(lastMessagePrefix("in", "Sara")).toBeNull();
    expect(lastMessagePrefix("out", "Cati")).toBe("Cati: ");
    expect(lastMessagePrefix("out", null, "*SARA - CASA FIAES:*\nOi")).toBe("Sara: ");
    expect(lastMessagePrefix("out", null, "Lembrete")).toBe("Casa: ");
  });
  it("linha da dona", () => {
    expect(ownerLine("Sara Lima", null)).toBe("Sara");
    expect(ownerLine("Sara", "Cati")).toBe("Dona: Sara · respondida por Cati");
    expect(ownerLine(null, null)).toBe("Sem dono");
    expect(ownerLine(null, "Cati")).toBe("Sem dono · respondida por Cati");
  });
  it("agenda: com quem está a conversa", () => {
    expect(conversationWith("Sara Lima")).toBe("Conversa com: Sara");
    expect(conversationWith(null)).toBe("Conversa sem dono");
  });
});
