import { beforeEach, expect, it, vi } from "vitest";

const user = vi.hoisted(() => ({ id: "u1", perms: [] as string[] }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", async () => {
  const { UserFacingError } = await import("@/server/domain/errors");
  const check = async (p: string) => { if (!user.perms.includes(p)) throw new UserFacingError("Você não tem permissão para isso."); return user; };
  return { assertPerm: check, assertAnyPerm: check, assertUser: async () => user };
});
vi.mock("@/server/domain/agenda/visits", async (orig) => {
  const m = await orig<typeof import("@/server/domain/agenda/visits")>();
  return { ...m, createVisit: vi.fn(async () => { throw new m.ExistingAppointmentError("Paula já tem Corte às 10:00 (veio do Avec). Abrir o horário", "11111111-1111-4111-8111-111111111111", "2026-10-16"); }) };
});
import { createVisitAction, searchClientsAction, setAppointmentLabelAction, setAppointmentStatusAction, setVisitTypeAction } from "./actions";

beforeEach(() => { user.perms = []; });
const input = {
  requestKey: "22222222-2222-4222-8222-222222222222", client: { contactId: "33333333-3333-4333-8333-333333333333" }, startsAt: "2026-10-16T13:00:00.000Z",
  items: [{ serviceId: "44444444-4444-4444-8444-444444444444", professionalId: null, preference: "sem_preferencia" as const }],
};

it("sem agenda.marcar, marcar é recusado no servidor (esconder o botão não basta)", async () => {
  user.perms = ["atendimento.ver"];
  expect(await createVisitAction(input)).toEqual({ ok: false, error: "Você não tem permissão para isso." });
});

it("horário que já existe: a tela recebe o texto e o horário para abrir", async () => {
  user.perms = ["agenda.marcar"];
  expect(await createVisitAction(input)).toEqual({
    ok: false, error: "Paula já tem Corte às 10:00 (veio do Avec). Abrir o horário", openAppointment: { id: "11111111-1111-4111-8111-111111111111", day: "2026-10-16" },
  });
});

it("buscar cliente pede atendimento.ver; status com id inválido volta como erro, sem quebrar", async () => {
  expect(await searchClientsAction("pa")).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  user.perms = ["atendimento.ver"];
  expect((await setAppointmentStatusAction("x", "chegou")).ok).toBe(false);
});

it("Marcar sem dizer a preferência é recusado no servidor", async () => {
  user.perms = ["agenda.marcar"];
  expect(await createVisitAction({ ...input, items: [{ serviceId: input.items[0].serviceId, professionalId: null }] }))
    .toEqual({ ok: false, error: "Diga se ela quer uma profissional ou tanto faz." });
});

it("marcador e tipo pedem agenda.marcador no servidor: no Marcar e nas ações próprias", async () => {
  const ID = "55555555-5555-4555-8555-555555555555";
  user.perms = ["agenda.marcar"];
  expect(await createVisitAction({ ...input, labelId: ID })).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  expect(await createVisitAction({ ...input, visitType: "noiva" })).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  expect(await setAppointmentLabelAction(ID, ID)).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  expect(await setVisitTypeAction(ID, "noiva")).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  // com a permissão, passa da checagem e chega ao domínio (o createVisit simulado recusa por outro motivo)
  user.perms = ["agenda.marcar", "agenda.marcador"];
  expect((await createVisitAction({ ...input, labelId: ID })).ok).toBe(false);
  expect(await createVisitAction({ ...input, labelId: ID })).toMatchObject({ openAppointment: expect.anything() });
});
