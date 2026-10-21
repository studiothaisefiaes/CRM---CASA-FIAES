// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { sendMessageAction, handlers } = vi.hoisted(() => ({
  sendMessageAction: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { waitedSeconds: null } })),
  handlers: [] as { scopes: string[]; fn: (e: { type: string; [k: string]: unknown }) => void }[],
}));
vi.mock("@/app/(app)/funil/actions", () => ({ sendMessageAction, sendMediaAction: vi.fn() }));
vi.mock("@/app/(app)/conversa/actions", () => ({ addNoteAction: vi.fn(), scheduleMessageAction: vi.fn(), sendQuickReplyAction: vi.fn() }));
vi.mock("@/components/shell/live", () => ({
  useLive: (scopes?: string[], fn?: (e: { type: string }) => void) => { if (scopes && fn) handlers.push({ scopes, fn }); return { subscribe: () => () => {}, requestRefresh: () => {} }; },
}));
import { Composer } from "./composer";

// O tempo real de mentira: entrega o aviso a quem assinou o escopo (o último registro de cada render vale).
const live = (scope: string, e: { type: string; [k: string]: unknown }) => act(() => { for (const h of handlers.filter((x) => x.scopes.includes(scope))) h.fn(e); });
const fetchSpy = vi.fn(async (..._a: unknown[]) => new Response("{}"));
beforeEach(() => { window.localStorage.clear(); handlers.length = 0; vi.stubGlobal("fetch", fetchSpy); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
const tela = () => render(<Composer dealId="d1" firstName="Maria" quickReplies={[]} onOptimistic={() => {}} me="eu" />);

describe("colisão (pesquisa 20/10, Help Scout)", () => {
  it("mostra quem mais da equipe está escrevendo (nunca a própria pessoa) e some quando ela envia", () => {
    tela();
    live("escrevendo:d1", { type: "escrevendo", dealId: "d1", userId: "eu", nome: "Eu" });
    expect(screen.queryByText(/está escrevendo/)).toBeNull();
    live("escrevendo:d1", { type: "escrevendo", dealId: "d1", userId: "sara", nome: "Sara" });
    expect(screen.getByRole("status").textContent).toContain("Sara está escrevendo…");
    live("deal:d1", { type: "mensagem_enviada", dealId: "d1" });
    expect(screen.queryByText(/está escrevendo/)).toBeNull();
  });

  it("digitar avisa as outras telas, sem mandar o texto", () => {
    tela();
    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "Oi Maria, tenho quinta" } });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/conversa/d1/escrevendo");
    expect(init.body).toBeUndefined();
  });

  it("chegou mensagem da cliente enquanto escrevia: pergunta antes de enviar", async () => {
    tela();
    const field = screen.getByLabelText("Mensagem");
    fireEvent.change(field, { target: { value: "Tenho quinta às 14h" } });
    live("deal:d1", { type: "mensagem_recebida", dealId: "d1" });
    await new Promise((r) => setTimeout(r, 500));
    fireEvent.keyDown(field, { key: "Enter" });
    expect(screen.getByText("Chegou mensagem nova dela. Enviar mesmo assim?")).toBeTruthy();
    expect(sendMessageAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Enviar mesmo assim" }));
    await waitFor(() => expect(sendMessageAction).toHaveBeenCalledWith("d1", "Tenho quinta às 14h", null));
  });

  it("“Ler antes” guarda o texto e não envia; mensagem com o campo vazio não pergunta nada", async () => {
    tela();
    const field = screen.getByLabelText("Mensagem") as HTMLTextAreaElement;
    live("deal:d1", { type: "mensagem_recebida", dealId: "d1" }); // campo vazio: nada a perguntar
    fireEvent.change(field, { target: { value: "Pode ser sexta?" } });
    await new Promise((r) => setTimeout(r, 500));
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(sendMessageAction).toHaveBeenCalledTimes(1));
    fireEvent.change(field, { target: { value: "E sábado?" } });
    live("deal:d1", { type: "mensagem_recebida", dealId: "d1" });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Ler antes" }));
    expect(field.value).toBe("E sábado?");
    expect(sendMessageAction).toHaveBeenCalledTimes(1);
  });
});
