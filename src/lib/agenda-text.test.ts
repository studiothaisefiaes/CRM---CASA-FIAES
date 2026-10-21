import { expect, it } from "vitest";
import { cancelNoticeText, conflictText, hourOf, justTakenText, refusalText, type ConflictDetail } from "./agenda-text";

const c = (over: Partial<ConflictDetail> = {}): ConflictDetail => ({
  id: "x", clientName: "Paula Souza", serviceLabel: "Corte", professionalName: "Ana Lima", startsAt: "2026-10-16T13:00:00.000Z", endsAt: "2026-10-16T14:20:00.000Z",
  sameClient: false, createdByName: "Cati", createdAt: "2026-10-16T13:02:00.000Z", ...over,
});

it("horário em Salvador, qualquer que seja o fuso do processo", () => {
  expect(hourOf("2026-10-16T13:00:00.000Z")).toBe("10:00");
});
it("conflito com a mesma profissional e com a mesma cliente (spec 6.1 e 6.6)", () => {
  expect(conflictText("Ana", c())).toBe("Ana já tem Paula das 10:00 às 11:20");
  expect(conflictText("Bia", c({ sameClient: true, serviceLabel: "Escova", professionalName: "Bia Santos" }))).toBe("Paula já tem Escova às 10:00 com a Bia");
});
it("a segunda pessoa a marcar o mesmo horário", () => {
  expect(justTakenText(c())).toBe("Esse horário acabou de ser ocupado (Cati marcou Paula às 10:02). Escolha outro.");
});
it("recusas do motor, com as frases da spec", () => {
  expect(refusalText("atravessa_meia_noite", { proName: "Ana", serviceLabel: "Corte" })).toBe("Esse horário passa da meia-noite");
  expect(refusalText("sem_duracao", { proName: "Ana", serviceLabel: "Mechas" })).toBe("Mechas não tem duração cadastrada. Diga quanto tempo leva desta vez.");
  expect(refusalText("fora_do_horario", { proName: "Carla Souza", serviceLabel: "Corte" })).toBe("Fora do horário de trabalho de Carla.");
  expect(refusalText("bloqueado", { proName: "Ana", serviceLabel: "Corte", blockedBy: "Almoço" })).toBe("Ana está com a agenda bloqueada nesse horário (Almoço).");
});
it("aviso de cancelamento: texto pronto para colar (nada é enviado)", () => {
  expect(cancelNoticeText({ clientName: "Paula Souza", startsAt: "2026-10-16T13:00:00.000Z", services: ["Corte", "Hidratação"] }))
    .toBe("Oi, Paula! Seu horário de sexta-feira, 16/10 às 10:00 (Corte e Hidratação) foi cancelado. Quer marcar outro dia? É só responder aqui.");
});
