import { describe, expect, it } from "vitest";
import { NEW_WHILE_TYPING, TYPING_PING_MS, TYPING_SHOW_MS, shouldPingTyping, typingNow, typingText } from "./collision";
import { scopesOf, shouldRefresh } from "./live-scope";

describe("colisão na conversa (pesquisa 20/10)", () => {
  it("o aviso de quem digita sai no máximo a cada 3 s e só com texto no campo", () => {
    expect(shouldPingTyping("oi", 0, TYPING_PING_MS)).toBe(true);
    expect(shouldPingTyping("oi", 1_000, 1_000 + TYPING_PING_MS - 1)).toBe(false);
    expect(shouldPingTyping("   ", 0, 99_000)).toBe(false);
  });
  it("frase de quem está escrevendo", () => {
    expect(typingText([])).toBe("");
    expect(typingText(["Sara"])).toBe("Sara está escrevendo…");
    expect(typingText(["Sara", "Cati"])).toBe("Sara e Cati estão escrevendo…");
    expect(typingText(["Sara", "Cati", "Bia", "Sara"])).toBe("Sara, Cati e Bia estão escrevendo…");
    expect(NEW_WHILE_TYPING).toBe("Chegou mensagem nova dela. Enviar mesmo assim?");
  });
  it("quem vê a tela nunca aparece; aviso velho (7 s) some", () => {
    const seen = new Map([["eu", { name: "Eu", at: 1_000 }], ["sara", { name: "Sara", at: 1_000 }], ["cati", { name: "Cati", at: 0 }]]);
    expect(typingNow(seen, "eu", 1_000 + TYPING_SHOW_MS - 1)).toEqual(["Sara"]);
    expect(typingNow(seen, "eu", 1_000 + TYPING_SHOW_MS)).toEqual([]);
  });
  it("o aviso tem escopo próprio: não recarrega a conversa aberta nem a Fila", () => {
    const e = { type: "escrevendo", dealId: "abc", userId: "u", nome: "Sara" };
    expect(scopesOf(e)).toEqual(["escrevendo:abc"]);
    expect(shouldRefresh(e, ["deal:abc", "queue"])).toBe(false);
    expect(shouldRefresh(e, ["escrevendo:abc"])).toBe(true);
    expect(scopesOf({ type: "mensagem_recebida", dealId: "abc" })).toEqual(["queue", "deal:abc"]);
  });
});
