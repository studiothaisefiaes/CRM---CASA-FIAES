import { describe, expect, it } from "vitest";
import { NEUTRAL_COMMISSION_RULES, effectiveRules, readCommissionRules, readProCommissionRules } from "./commission-rules";

describe("regras da comissão", () => {
  it("lê com o neutro no que falta e mescla a da profissional", () => {
    expect(readCommissionRules({ cartao: "antes", antecipacaoBp: -1, doisAssistentes: "x" })).toEqual({ ...NEUTRAL_COMMISSION_RULES, cartao: "antes" });
    expect(readCommissionRules("lixo")).toEqual(NEUTRAL_COMMISSION_RULES);
    expect(readProCommissionRules(null)).toBeNull();
    expect(readProCommissionRules({ custo: "nao", cartao: "x" })).toEqual({ custo: "nao" });
    expect(effectiveRules({ ...NEUTRAL_COMMISSION_RULES, custo: "depois" }, { custo: "nao" }).custo).toBe("nao");
  });
});
