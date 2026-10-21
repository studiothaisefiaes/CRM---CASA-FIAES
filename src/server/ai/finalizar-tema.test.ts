import { describe, expect, it } from "vitest";
import { finalizar } from "./suggest";

const now = new Date("2026-10-20T20:15:00Z");
const opcao = { id: "h1", day: "2026-10-22", time: "09:00", professionalId: "p1", professionalName: "Jackson", serviceId: "s1", serviceLabel: "Corte", durationMin: 60, origem: "lista" as const };
const free = { line: "Horários livres (Corte, 1 h): qui 22/10 Jackson 9h (h1)", options: [opcao], fora: "ter 20/10", pediu: true, texts: ["tem horário hoje?"] };

describe("o pedido da atendente manda (20/10, caso Uirá)", () => {
  const texto = "Uirá, conforme conversamos por ligação, ficamos aguardando o seu retorno na terça-feira. Obrigada pela paciência e até breve! 💛";
  it("com o 'Sobre o quê?' preenchido, o servidor não cola horário no texto", () => {
    const r = finalizar(texto, null, { free, combinado: null, temaDado: true }, now);
    expect(r.sugestao).toBe(texto);
    expect(r.garantido).toBe(false);
  });
  it("sem pedido, a garantia do horário continua (a cliente pediu horário)", () => {
    const r = finalizar("Uirá, vou ver a agenda e te falo.", null, { free, combinado: null }, now);
    expect(r.sugestao).not.toBe("Uirá, vou ver a agenda e te falo.");
  });
});
