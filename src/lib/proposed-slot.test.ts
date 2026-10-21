import { describe, expect, it } from "vitest";
import { confirmText, isConfirmation } from "./proposed-slot";

describe("confirmação do horário marcado pela sugestão da IA (padrão da Casa, para WhatsApp, 21/10)", () => {
  it("curta, com data por extenso e hora em negrito cada uma na sua linha, serviço e profissional", () => {
    expect(confirmText({ day: "2026-10-22", time: "14:00", professionalName: "THAISE FIAES", serviceLabel: "Avaliação" })).toBe([
      "Confirmado agendamento de Avaliação com Thaise 💛", "", "📅 *quinta-feira, 22/10*", "⏰ às *14h*", "",
      "Temos tolerância de 15 minutos. Será uma alegria te receber na Casa Fiaes!",
    ].join("\n"));
  });

  it("minutos, sábado, sem serviço ou sem profissional", () => {
    expect(confirmText({ day: "2026-10-24", time: "09:30", professionalName: null, serviceLabel: null }).split("\n").slice(0, 4))
      .toEqual(["Confirmado agendamento 💛", "", "📅 *sábado, 24/10*", "⏰ às *9h30*"]);
    expect(confirmText({ day: "2026-10-24", time: "09:30", professionalName: "Jackson", serviceLabel: null }).split("\n")[0]).toBe("Confirmado agendamento com Jackson 💛");
  });

  it("negrito só na data e na hora; continua sendo reconhecida como confirmação", () => {
    const t = confirmText({ day: "2026-10-22", time: "14:00", professionalName: "THAISE FIAES", serviceLabel: "Avaliação" });
    expect([...t.matchAll(/\*([^*\n]+)\*/g)].map((m) => m[1])).toEqual(["quinta-feira, 22/10", "14h"]);
    expect(isConfirmation(t)).toBe(true);
  });
});
