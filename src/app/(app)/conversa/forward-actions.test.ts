import { beforeEach, expect, it, vi } from "vitest";

const { asked, calls, allowed, scoped, later, refuse } = vi.hoisted(() => ({ asked: [] as string[], calls: [] as string[], allowed: { v: true }, scoped: [] as string[],
  /** O que a action deixou para depois da resposta (`after`). */ later: [] as (() => unknown)[], refuse: { v: null as string | null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => { later.push(fn); } }));
vi.mock("@/server/auth/session", () => ({
  assertPerm: async (p: string) => { asked.push(p); if (!allowed.v) throw new Error("Você não tem permissão para isso."); return { id: "u1", perms: [] }; },
}));
vi.mock("@/server/domain/deal-scope", () => ({
  assertCanActOnDeal: async (_u: unknown, id: string) => { scoped.push(`deal:${id}`); },
  assertCanActOnMessage: async (_u: unknown, id: string) => { scoped.push(`msg:${id}`); if (id.endsWith("9")) throw new Error("Essa conversa é de outra atendente."); },
  assertCanActOnOutbox: async () => {},
}));
vi.mock("@/server/domain/forward", () => ({
  prepareForward: async (ids: string[], n: number) => { calls.push(`conferir:${ids.length}:${n}`); if (refuse.v) throw new Error(refuse.v); return { items: ids }; },
  forwardInBackground: async (plan: { items: string[] }, to: string[]) => { calls.push(`enviar:${plan.items.length}:${to.join(",")}`); },
}));
vi.mock("@/server/domain/start-conversation", () => ({ startConversation: async (c: string) => { calls.push(`abrir:${c}`); return { dealId: "00000000-0000-4000-8000-0000000000c1" }; } }));
vi.mock("@/server/domain/new-client", () => ({ startNewConversation: async (p: { phone: string }) => { calls.push(`cadastrar:${p.phone}`); return { dealId: "00000000-0000-4000-8000-0000000000c2" }; } }));
vi.mock("@/server/queries/forward-targets", () => ({ forwardTargets: async () => { calls.push("targets"); return []; } }));
import { forwardMessagesAction, forwardTargetsAction } from "./actions";

const U = "00000000-0000-4000-8000-000000000001", M2 = "00000000-0000-4000-8000-000000000002", FORA = "00000000-0000-4000-8000-000000000009";
beforeEach(() => { asked.length = 0; calls.length = 0; scoped.length = 0; later.length = 0; allowed.v = true; refuse.v = null; });

it("encaminhar e buscar destinos pedem mensagem.encaminhar", async () => {
  expect(await forwardMessagesAction([U], [U])).toMatchObject({ ok: true, data: { messages: 1, targets: 1 } });
  expect(await forwardTargetsAction("a", null)).toMatchObject({ ok: true });
  expect(asked).toEqual(["mensagem.encaminhar", "mensagem.encaminhar"]);
});
it("sem a permissão é recusado no servidor e nada é feito", async () => {
  allowed.v = false;
  expect(await forwardMessagesAction([U], [U])).toMatchObject({ ok: false });
  expect(await forwardTargetsAction("a", null)).toMatchObject({ ok: false });
  expect(calls).toEqual([]);
  expect(later).toEqual([]);
});
it("várias: confere o escopo de cada mensagem e de cada destino antes de encaminhar", async () => {
  expect(await forwardMessagesAction([U, M2], [U])).toMatchObject({ ok: true, data: { messages: 2 } });
  expect(scoped).toEqual([`msg:${U}`, `msg:${M2}`, `deal:${U}`]);
});
it("uma mensagem fora do escopo recusa tudo, sem abrir conversa nova nem encaminhar", async () => {
  expect(await forwardMessagesAction([U, FORA], [{ phone: "71988887777" }])).toMatchObject({ ok: false });
  expect(calls).toEqual([]);
  expect(later).toEqual([]);
});
it("devolve na hora: os envios ficam para depois da resposta (o 'Para quem?' não fica preso esperando o WhatsApp)", async () => {
  const r = await forwardMessagesAction([U, M2], [U, { contactId: M2 }]);
  expect(r).toEqual({ ok: true, data: { messages: 2, targets: 2 } });
  expect(calls).toEqual(["conferir:2:2", `abrir:${M2}`]);
  expect(later).toHaveLength(1);
  await later[0]();
  expect(calls.at(-1)).toBe(`enviar:2:${U},00000000-0000-4000-8000-0000000000c1`);
});
it("pedido que vai ser recusado (limite, mensagem que não encaminha, de outra pessoa) não abre conversa nova antes", async () => {
  refuse.v = "Dá para encaminhar até 5 mensagens de uma vez.";
  expect(await forwardMessagesAction([U, M2], [{ phone: "71988887777" }, { contactId: M2 }])).toEqual({ ok: false, error: expect.stringContaining("até 5 mensagens") });
  expect(calls).toEqual(["conferir:2:2"]);
  expect(later).toEqual([]);
});
