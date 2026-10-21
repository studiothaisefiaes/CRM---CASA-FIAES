import { describe, expect, it } from "vitest";
import { hidePhone } from "./hide-phone";

describe("telefone cru nunca aparece na tela (Hoje v3: 'Responder +557190000002')", () => {
  it("troca o telefone da cliente pelo nome dela", () => {
    expect(hidePhone("Responder +557190000002", "Olga", "+557190000002")).toBe("Responder Olga");
    expect(hidePhone("Responder 71 9000-0002", "Olga", "+557190000002")).toBe("Responder Olga"); // sem o DDI
  });
  it("sem nome (ou com o próprio telefone no lugar do nome): cliente com final", () => {
    expect(hidePhone("Responder +557190000002")).toBe("Responder cliente com final 5353");
    expect(hidePhone("Responder +557190000002", "+557190000002", "+557190000002")).toBe("Responder cliente com final 5353");
    expect(hidePhone("Responder +557190000002", "Olga")).toBe("Responder cliente com final 5353"); // sem o telefone dela para conferir
    expect(hidePhone("+55 71 9000-0002", null)).toBe("Cliente com final 5353");
    expect(hidePhone("(71) 99795-0901 escreveu")).toBe("Cliente com final 0901 escreveu");
  });
  it("número de outra pessoa não ganha o nome da cliente: vira 'cliente com final' (nunca informação errada)", () => {
    expect(hidePhone("Ligar para a irmã 71 99999-1234", "Olga", "+557190000002")).toBe("Ligar para a irmã cliente com final 1234");
    expect(hidePhone("Responder +557190000002", "Olga", "+557190000002")).toBe("Responder Olga");
  });
  it("texto sem telefone fica igual (hora, dinheiro, data)", () => {
    for (const s of ["Ligar às 10:00", "Orçamento de R$ 150,00", "Retorno em 17/10/2026", "Retorno em 17.10.2026", "Comanda 1234"]) expect(hidePhone(s, "Olga")).toBe(s);
  });
});
