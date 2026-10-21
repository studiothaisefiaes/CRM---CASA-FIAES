import { describe, expect, it } from "vitest";
import { conversationStatus, retomadaSuperada, retomarWhen, STATUS_COLOR, STATUS_LABEL, statusTone } from "./conversation-status";

const T = "2026-10-15T12:00:00Z";

describe("status da conversa (pedido do dono, 16/10): Aberto, Aguardando e Resolvido", () => {
  it("Resolvido: a conversa foi resolvida (o antigo Encerrar) e a cliente não escreveu de novo", () => {
    expect(conversationStatus({ archivedAt: T, awaitingSince: null })).toBe("resolvido");
  });
  it("Aberto: a cliente espera a Casa", () => {
    expect(conversationStatus({ archivedAt: null, awaitingSince: T })).toBe("aberto");
  });
  it("Aguardando: ninguém espera a Casa (a Casa falou por último, ou a resposta não é preciso)", () => {
    expect(conversationStatus({ archivedAt: null, awaitingSince: null })).toBe("aguardando");
  });
  it("nomes e cores próprios (nenhum igual ao de etapa); Aberto atrasado fica vermelho", () => {
    expect(STATUS_LABEL).toEqual({ aberto: "Aberto", aguardando: "Aguardando", resolvido: "Resolvido" });
    expect(new Set(Object.values(STATUS_COLOR)).size).toBe(3);
    for (const c of ["#a87a2c", "#b8863f", "#121212", "#8a6a2f", "#2f6b4f", "#b5654a", "#3d7a5c", "#6b5b8a", "#9a958c"]) expect(Object.values(STATUS_COLOR)).not.toContain(c);
    expect(statusTone("aberto", true)).toBe("#b3261e");
    expect(statusTone("aberto", false)).toBe(STATUS_COLOR.aberto);
    expect(statusTone("aguardando", true)).toBe(STATUS_COLOR.aguardando);
  });
  it("combinado vencido com conversa depois não é mais 'Para retomar' (Luciana, 20/10: cliente de sábado falando e a tela 'venceu 18/10')", () => {
    const now = new Date("2026-10-20T21:20:00Z").getTime();
    const due = "2026-10-19T00:00:00Z"; // dom 18/10 21:00 em Salvador
    expect(retomadaSuperada(due, "2026-10-20T21:16:00Z", now)).toBe(true);
    expect(retomarWhen({ awaitingSince: null, dueAt: due, lastAt: "2026-10-20T21:16:00Z" }, now)).toBeNull();
    // Sem conversa depois do vencimento: continua para retomar (vermelho "venceu").
    expect(retomadaSuperada(due, "2026-10-17T13:00:00Z", now)).toBe(false);
    expect(retomarWhen({ awaitingSince: null, dueAt: due, lastAt: "2026-10-17T13:00:00Z" }, now)).not.toBeNull();
    // Data à frente: conversar antes não tira a retomada marcada.
    expect(retomarWhen({ awaitingSince: null, dueAt: "2026-10-25T13:00:00Z", lastAt: "2026-10-20T21:16:00Z" }, now)).not.toBeNull();
  });
});
