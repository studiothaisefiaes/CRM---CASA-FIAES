import { it, expect } from "vitest";
import { askAttendance, primaryAction } from "./primary-action";

const now = new Date("2026-10-14T15:00:00Z");
const base = { ownerId: "eu", stageKind: "lead", scheduledAt: null as string | null, attendance: null as string | null };

it("o que fazer agora, pelo momento do lead", () => {
  expect(primaryAction({ ...base, ownerId: "outra" }, "eu", now)).toBe("assumir");
  expect(primaryAction({ ...base, ownerId: null }, "eu", now)).toBe("assumir");
  expect(primaryAction(base, "eu", now)).toBe("agendar");
  expect(primaryAction({ ...base, stageKind: "followup" }, "eu", now)).toBe("agendar");
  expect(primaryAction({ ...base, stageKind: "agendado", scheduledAt: "2026-10-15T12:00:00Z" }, "eu", now)).toBe("remarcar");
  expect(primaryAction({ ...base, stageKind: "agendado", scheduledAt: "2026-10-14T12:00:00Z" }, "eu", now)).toBe("conferir");
  expect(primaryAction({ ...base, stageKind: "agendado", scheduledAt: "2026-10-14T12:00:00Z", attendance: "compareceu" }, "eu", now)).toBe("fechar");
  expect(primaryAction({ ...base, stageKind: "fechado" }, "eu", now)).toBeNull();
  expect(primaryAction({ ...base, stageKind: "perdido" }, "eu", now)).toBeNull();
});

it("sem permissão de fechar venda (Recepção), a ação principal nunca é Fechar venda", () => {
  const compareceu = { ...base, stageKind: "agendado", scheduledAt: "2026-10-14T12:00:00Z", attendance: "compareceu" };
  expect(primaryAction(compareceu, "eu", now, { canClose: false })).toBeNull();
  expect(primaryAction(compareceu, "eu", now, { canClose: true })).toBe("fechar");
  expect(primaryAction(base, "eu", now, { canClose: false })).toBe("agendar");
});

it("'Compareceu?' só depois do horário; já marcado continua visível para corrigir; fora de Agendado nunca", () => {
  const now = Date.parse("2026-10-15T15:00:00Z");
  expect(askAttendance({ stageKind: "agendado", scheduledAt: "2026-10-17T13:00:00Z", attendance: null }, now)).toBe(false);
  expect(askAttendance({ stageKind: "agendado", scheduledAt: "2026-10-17T13:00:00Z", attendance: "confirmado" }, now)).toBe(false);
  expect(askAttendance({ stageKind: "agendado", scheduledAt: "2026-10-15T14:00:00Z", attendance: null }, now)).toBe(true);
  expect(askAttendance({ stageKind: "agendado", scheduledAt: "2026-10-17T13:00:00Z", attendance: "faltou" }, now)).toBe(true);
  expect(askAttendance({ stageKind: "atendimento", scheduledAt: "2026-10-15T14:00:00Z", attendance: null }, now)).toBe(false);
});

it("Atendida: a ação principal é Fechar venda (sem permissão: nenhuma)", () => {
  expect(primaryAction({ ...base, stageKind: "atendido" }, "eu", now)).toBe("fechar");
  expect(primaryAction({ ...base, stageKind: "atendido" }, "eu", now, { canClose: false })).toBeNull();
});
it("'Compareceu?' continua para corrigir depois que a conversa foi para Atendida ou Aguardando", () => {
  const now = Date.parse("2026-10-15T15:00:00Z");
  expect(askAttendance({ stageKind: "atendido", scheduledAt: "2026-10-15T13:00:00Z", attendance: "compareceu" }, now)).toBe(true);
  expect(askAttendance({ stageKind: "followup", scheduledAt: "2026-10-15T13:00:00Z", attendance: "faltou" }, now)).toBe(true);
  expect(askAttendance({ stageKind: "followup", scheduledAt: null, attendance: null }, now)).toBe(false);
});
