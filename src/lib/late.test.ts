import { describe, expect, it } from "vitest";
import { countLate, crossedUp, lateAnnouncement, lateTitle } from "./late";

const a = (dealId: string | null, over: Partial<{ type: string; resolved: boolean }> = {}) => ({ dealId, type: "sem_resposta_minutos", resolved: false, ...over });

describe("countLate", () => {
  it("conta leads (não alertas) com espera vencida e ainda aberta", () => {
    expect(countLate([a("1"), a("1"), a("2"), a("3", { resolved: true }), a("4", { type: "tarefa_vencida" }), a(null)])).toBe(2);
  });
  it("lista vazia dá zero", () => { expect(countLate([])).toBe(0); });
});

describe("crossedUp (cruzou o limite)", () => {
  it("nunca no primeiro render", () => { expect(crossedUp(null, 3)).toBe(false); });
  it("só quando o número sobe", () => {
    expect(crossedUp(0, 1)).toBe(true);
    expect(crossedUp(2, 3)).toBe(true);
  });
  it("não repete em refresh (igual) nem quando desce", () => {
    expect(crossedUp(2, 2)).toBe(false);
    expect(crossedUp(3, 1)).toBe(false);
    expect(crossedUp(1, 0)).toBe(false);
  });
});

describe("lateTitle", () => {
  it("troca o título quando há atrasados e devolve o original quando zera", () => {
    expect(lateTitle(2, "Hoje · Casa Fiaes")).toBe("(2) atrasados · Casa Fiaes");
    expect(lateTitle(0, "Hoje · Casa Fiaes")).toBe("Hoje · Casa Fiaes");
  });
});

describe("lateAnnouncement", () => {
  it("singular e plural", () => {
    expect(lateAnnouncement(1)).toBe("1 lead atrasado");
    expect(lateAnnouncement(4)).toBe("4 leads atrasados");
    expect(lateAnnouncement(0)).toBe("");
  });
});
