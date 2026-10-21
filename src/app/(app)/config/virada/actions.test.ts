import { beforeEach, expect, it, vi } from "vitest";

const { asked, calls, allowed } = vi.hoisted(() => ({ asked: [] as string[], calls: [] as unknown[][], allowed: { perms: new Set<string>() } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", () => ({
  assertPerm: async (p: string) => { asked.push(p); if (!allowed.perms.has(p)) throw new Error("Você não tem permissão para isso."); return { id: "u1" }; },
}));
vi.mock("@/server/domain/virada", () => ({
  saveVirada: async (...a: unknown[]) => { calls.push(["saveVirada", ...a]); },
  sendViradaTest: async (...a: unknown[]) => { calls.push(["sendViradaTest", ...a]); return { dealId: "d1" }; },
}));
vi.mock("@/server/domain/client-link/settings", () => ({ getLembreteD1: async () => ({ enabled: false, comLink: false, texto: "t", textoRemarcado: "r" }) }));
vi.mock("@/server/domain/client-link/reminder", () => ({ saveLembreteD1: async (...a: unknown[]) => { calls.push(["saveLembreteD1", ...a]); } }));
vi.mock("@/server/domain/after-visit", () => ({
  getAfterVisit: async () => ({ mode: "desligado", linkGoogle: "https://g" }),
  saveAfterVisit: async (...a: unknown[]) => { calls.push(["saveAfterVisit", ...a]); },
}));
import { ligarViradaAction, saveViradaAction, sendViradaTestAction } from "./actions";

beforeEach(() => { asked.length = 0; calls.length = 0; allowed.perms = new Set(["virada.fazer"]); });

it("marcar um passo pede virada.fazer e grava com quem pediu", async () => {
  expect(await saveViradaAction("lembrete", ["chatguru_lembrete"])).toEqual({ ok: true });
  expect(asked).toEqual(["virada.fazer"]);
  expect(calls).toEqual([["saveVirada", "lembrete", ["chatguru_lembrete"], "u1"]]);
});

it("mandar o teste pede virada.fazer", async () => {
  expect(await sendViradaTestAction("depois", "71988887777", "pesquisa")).toEqual({ ok: true });
  expect(asked).toEqual(["virada.fazer"]);
  expect(calls).toEqual([["sendViradaTest", "depois", "71988887777", "u1", { modo: "pesquisa" }]]);
});

it("ligar pede virada.fazer e passa a confirmação de envio real ao servidor (lembrete e Depois do atendimento)", async () => {
  expect(await ligarViradaAction("lembrete", { confirmouEnvio: true })).toEqual({ ok: true });
  expect(calls[0]).toEqual(["saveLembreteD1", { enabled: true, comLink: false, texto: "t", textoRemarcado: "r" }, "u1", { confirmouEnvio: true }]);
  expect(await ligarViradaAction("depois", { modo: "agradecimento" })).toEqual({ ok: true });
  expect(calls[1]).toEqual(["saveAfterVisit", { mode: "agradecimento", linkGoogle: "https://g" }, "u1", { confirmouEnvio: false }]);
  expect(asked).toEqual(["virada.fazer", "virada.fazer"]);
});

it("sem virada.fazer, as três são recusadas no servidor e nada é gravado nem enviado", async () => {
  allowed.perms = new Set(["config.sistema"]);
  const no = { ok: false, error: "Você não tem permissão para isso." };
  expect(await saveViradaAction("lembrete", [])).toEqual(no);
  expect(await sendViradaTestAction("lembrete", "71988887777")).toEqual(no);
  expect(await ligarViradaAction("lembrete", { confirmouEnvio: true })).toEqual(no);
  expect(calls).toEqual([]);
});

it("alvo ou modo inválido é recusado", async () => {
  expect(await saveViradaAction("outro", [])).toMatchObject({ ok: false });
  expect(await ligarViradaAction("depois", { modo: "desligado" as never })).toMatchObject({ ok: false });
  expect(calls).toEqual([]);
});
