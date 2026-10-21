import { beforeEach, expect, it, vi } from "vitest";

const { asked } = vi.hoisted(() => ({ asked: [] as string[] }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));
// Registra a permissão pedida e recusa: nenhuma regra de domínio roda.
vi.mock("@/server/auth/session", () => ({
  assertPerm: async (p: string) => { asked.push(p); throw new Error("recusado no teste"); },
  assertAnyPerm: async (...p: string[]) => { asked.push(p.join("|")); throw new Error("recusado no teste"); },
}));
import * as contatos from "./contatos/actions";
import * as conversa from "./conversa/actions";
import * as agenda from "./agenda/actions";
import * as zap from "./config/importar-whatsapp/actions";

const U = "00000000-0000-4000-8000-000000000001";
beforeEach(() => { asked.length = 0; });

it("QA r66 I-7: ver Clientes não edita, cadastra nem etiqueta (contatos.editar)", async () => {
  await contatos.updateContactProfileAction(U, {});
  await contatos.addContactTagAction(U, "x");
  await contatos.removeContactTagAction(U, U);
  await contatos.tagContactsAction([U], "x");
  await contatos.createClientAction({ name: "Ana", phone: "71999990000" } as never);
  await contatos.addPersonAction({ contactId: U, name: "Bia" } as never);
  expect(asked).toEqual(Array(6).fill("contatos.editar"));
});

it("QA r66 I-7: trazer a conversa do WhatsApp pede contatos.importar (ou config.sistema), nunca só contatos.ver", async () => {
  await zap.previewZapAction("t", {});
  await zap.applyZapAction("t", {});
  await zap.discardZapAction("t").catch(() => {});
  await zap.searchZapClientsAction("ana").catch(() => {});
  expect(asked).toHaveLength(4);
  for (const a of asked) { expect(a).toContain("contatos.importar"); expect(a).not.toContain("contatos.ver"); }
});

it("QA r66 I-7: apagar para todos pede mensagem.apagar_todos; Finalizar e Faltou pedem agenda.marcar; Confirmar segue com atendimento.ver", async () => {
  await conversa.deleteForEveryoneAction(U);
  await agenda.setAppointmentStatusAction(U, "compareceu");
  await agenda.setAppointmentStatusAction(U, "faltou");
  await agenda.setAppointmentStatusAction(U, "confirmado");
  expect(asked).toEqual(["mensagem.apagar_todos", "agenda.marcar", "agenda.marcar", "atendimento.ver"]);
});
