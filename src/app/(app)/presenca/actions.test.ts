import { beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ perms: [] as string[], set: [] as string[] }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", () => ({ assertUser: async () => ({ id: "u1", perms: h.perms }) }));
vi.mock("@/server/domain/presence", () => ({ setAvailability: async (_id: string, a: string) => { h.set.push(a); return { returned: 0 }; } }));
import { setAvailabilityAction } from "./actions";

beforeEach(() => { h.set = []; });

it("quem não atende conversas (o Contador) não fica Disponível: não conta como alguém para a cliente nem para o setor", async () => {
  h.perms = ["relatorios.ver", "valores.ver"];
  expect(await setAvailabilityAction("disponivel")).toEqual({ ok: false, error: "Seu perfil não atende conversas." });
  expect(h.set).toEqual([]);
  // Ficar ausente continua valendo (sair da conta marca ausente).
  expect(await setAvailabilityAction("ausente")).toEqual({ ok: true, returned: 0 });
});

it("quem atende muda o próprio estado como antes", async () => {
  h.perms = ["atendimento.ver"];
  expect(await setAvailabilityAction("disponivel")).toEqual({ ok: true, returned: 0 });
  expect(h.set).toEqual(["disponivel"]);
});
