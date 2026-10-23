// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UNCERTAIN_SEND_MESSAGE } from "@/lib/send-status";

const { sendMessageAction } = vi.hoisted(() => ({ sendMessageAction: vi.fn(async (..._a: unknown[]) => ({ ok: false as const, error: "" })) }));
vi.mock("@/app/(app)/funil/actions", () => ({ sendMessageAction, sendMediaAction: vi.fn() }));
vi.mock("@/app/(app)/conversa/actions", () => ({ addNoteAction: vi.fn(), scheduleMessageAction: vi.fn(), sendQuickReplyAction: vi.fn() }));
import { Composer } from "./composer";
import { Conversation, type Msg } from "./conversation";

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const out = (over: Partial<Msg>): Msg => ({ id: "m1", direction: "out", kind: "text", body: "Seu horário está confirmado", status: "failed", createdAt: new Date().toISOString(), sender: null, fromPhone: false, externalId: null, ...over });

it("envio incerto: o balão diz que pode ter chegado e pede para conferir, em vez de 'não enviada' (revisão 23/10)", () => {
  render(<Conversation messages={[out({ error: UNCERTAIN_SEND_MESSAGE })]} />);
  expect(screen.getByText("envio incerto")).toBeTruthy();
  expect(screen.getByText(/Pode ter chegado\. Confira no WhatsApp antes de enviar de novo\./)).toBeTruthy();
  expect(screen.queryByText("não enviada")).toBeNull();
});

it("falha de verdade continua 'não enviada' com o pedido de enviar de novo", () => {
  render(<Conversation messages={[out({ error: "número inválido" })]} />);
  expect(screen.getByText("não enviada")).toBeTruthy();
  expect(screen.getByText(/Não chegou na cliente/)).toBeTruthy();
});

it("envio incerto: o texto NÃO volta para o campo (voltava e a atendente reenviava)", async () => {
  sendMessageAction.mockResolvedValueOnce({ ok: false, error: UNCERTAIN_SEND_MESSAGE });
  render(<Composer dealId="d1" firstName="Maria" quickReplies={[]} onOptimistic={() => {}} />);
  const field = screen.getByLabelText("Mensagem") as HTMLTextAreaElement;
  fireEvent.change(field, { target: { value: "Seu horário está confirmado" } });
  fireEvent.keyDown(field, { key: "Enter" });
  await waitFor(() => expect(sendMessageAction).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 20));
  expect(field.value).toBe("");
});

it("erro de envio comum: o texto volta para o campo, como antes", async () => {
  sendMessageAction.mockResolvedValueOnce({ ok: false, error: "Não foi possível enviar: número inválido" });
  render(<Composer dealId="d1" firstName="Maria" quickReplies={[]} onOptimistic={() => {}} />);
  const field = screen.getByLabelText("Mensagem") as HTMLTextAreaElement;
  fireEvent.change(field, { target: { value: "Oi" } });
  fireEvent.keyDown(field, { key: "Enter" });
  await waitFor(() => expect(field.value).toBe("Oi"));
});
