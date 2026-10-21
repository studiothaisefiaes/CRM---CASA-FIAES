import { it, expect, vi } from "vitest";

const { asked, SERVICE_ITEM } = vi.hoisted(() => ({ asked: [] as string[], SERVICE_ITEM: "11111111-1111-4111-8111-111111111111" }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", async () => {
  const { PERMS } = await import("@/lib/permissions");
  const u = { id: "u1", perms: [...PERMS] };
  return { assertUser: async () => u, assertPerm: async (p: string) => { asked.push(p); return u; }, assertAnyPerm: async () => u };
});
vi.mock("@/server/domain/config", async (orig) => ({
  ...(await orig<typeof import("@/server/domain/config")>()),
  addListItem: async () => { throw Object.assign(new Error('duplicate key value violates unique constraint "lists_kind_label_uq"'), { code: "23505" }); },
  updateListItem: async () => { throw new Error("Escreva o texto da resposta pronta."); },
  listItemKind: async (id: string) => (id === SERVICE_ITEM ? "service" : "quick_reply"),
  disconnectChannel: async () => {}, toggleAutomation: async () => {},
}));
vi.mock("@/server/domain/distribution", async (orig) => ({ ...(await orig<typeof import("@/server/domain/distribution")>()), saveDistributionSettings: async () => {}, setPriorityLevel: async () => {} }));
vi.mock("@/server/domain/messaging-settings", async (orig) => ({ ...(await orig<typeof import("@/server/domain/messaging-settings")>()), saveAutoReply: async () => {} }));
vi.mock("@/server/domain/professionals", async (orig) => ({ ...(await orig<typeof import("@/server/domain/professionals")>()), createProfessional: async () => ({}), updateProfessional: async () => ({}), setProfessionalService: async () => ({}) }));
vi.mock("@/server/domain/agenda/who-does-what", async (orig) => ({ ...(await orig<typeof import("@/server/domain/agenda/who-does-what")>()), acceptSuggestions: async () => ({ added: 0 }) }));
vi.mock("@/server/domain/service-details", () => ({ saveServiceDetails: async () => {} }));
vi.mock("@/server/domain/deal-scope", async (orig) => ({ ...(await orig<typeof import("@/server/domain/deal-scope")>()), setStrictScope: async () => {} }));
import {
  acceptSuggestionsAction, addListItemAction, createProfessionalAction, disconnectChannelAction, saveAutoReplyAction, saveDistributionAction, setPriorityLevelAction,
  setProfessionalServiceAction, setStrictScopeAction, toggleAutomationAction, updateListItemAction, updateProfessionalAction,
} from "./actions";
import { saveServiceDetailsAction } from "./listas/actions";

const quiet = async <T>(fn: () => Promise<T>) => { const o = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = o; } };
const ID = "00000000-0000-4000-8000-000000000000";

it("erro de banco não chega cru à tela de Configurações", async () => {
  const r = await quiet(() => addListItemAction("service", "Corte", null));
  expect(r).toEqual({ ok: false, error: "Não deu certo. Tente de novo." });
});
it("erro do domínio (texto fixo) continua chegando", async () => {
  expect(await updateListItemAction(ID, "x", "", true)).toEqual({ ok: false, error: "Escreva o texto da resposta pronta." });
});
it("cada ação pede a permissão certa: dia a dia × sistema (Lote 4)", async () => {
  const cases: [string, () => Promise<unknown>, string][] = [
    ["listas", () => addListItemAction("objection", "Caro", null), "config.diaadia"],
    ["níveis da distribuição", () => setPriorityLevelAction(ID, 1), "config.diaadia"],
    ["profissionais", () => createProfessionalAction({ name: "Teste", serviceIds: [] }), "config.diaadia"],
    ["WhatsApp", () => disconnectChannelAction(ID, false), "config.sistema"],
    ["automações", () => toggleAutomationAction(ID, false), "config.sistema"],
    ["ligar a distribuição", () => saveDistributionAction({ enabled: false, limit: 3 }), "config.sistema"],
    ["mensagem automática", () => saveAutoReplyAction({ enabled: false, text: "" }), "config.sistema"],
    ["atendente só mexe nas próprias conversas (Perfis)", () => setStrictScopeAction(true), "equipe.gerir"],
  ];
  for (const [nome, call, perm] of cases) { asked.length = 0; await quiet(call); expect(asked[0], nome).toBe(perm); }
});

it("serviço (preço, cadastro e quem faz) pede servicos.editar, não config.diaadia (revisão de segurança 17/10, M2)", async () => {
  const P = "22222222-2222-4222-8222-222222222222";
  const cases: [string, () => Promise<unknown>][] = [
    ["preço, duração e categoria", () => saveServiceDetailsAction(SERVICE_ITEM, { priceCents: 100 })],
    ["criar serviço pela lista", () => addListItemAction("service", "Corte", null)],
    ["renomear ou desativar serviço pela lista", () => updateListItemAction(SERVICE_ITEM, "Corte", null, false)],
    ["quem faz o quê (matriz)", () => setProfessionalServiceAction(P, SERVICE_ITEM, true)],
    ["aceitar sugestões do Avec", () => acceptSuggestionsAction({})],
    ["profissional nova já com serviços", () => createProfessionalAction({ name: "Teste", serviceIds: [SERVICE_ITEM] })],
    ["trocar os serviços da profissional", () => updateProfessionalAction(P, { serviceIds: [SERVICE_ITEM] })],
  ];
  for (const [nome, call] of cases) { asked.length = 0; await quiet(call); expect(asked, nome).toContain("servicos.editar"); }
});
it("o resto das listas e da profissional continua no dia a dia", async () => {
  const P = "22222222-2222-4222-8222-222222222222";
  const cases: [string, () => Promise<unknown>][] = [
    ["resposta pronta", () => updateListItemAction(ID, "x", "y", true)],
    ["profissional sem serviços", () => createProfessionalAction({ name: "Teste", serviceIds: [] })],
    ["nome da profissional", () => updateProfessionalAction(P, { name: "Aninha" })],
  ];
  for (const [nome, call] of cases) { asked.length = 0; await quiet(call); expect(asked, nome).toEqual(["config.diaadia"]); }
});
it("o período de repasse da profissional pede comissao.pagar (Fase A, Tarefa 9)", async () => {
  const P = "22222222-2222-4222-8222-222222222222";
  asked.length = 0;
  await quiet(() => updateProfessionalAction(P, { payoutPeriod: "quinzenal" }));
  expect(asked).toEqual(["config.diaadia", "comissao.pagar"]);
  expect((await updateProfessionalAction(P, { payoutPeriod: "anual" as never })).ok).toBe(false);
});
