// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { sendMessageAction } = vi.hoisted(() => ({ sendMessageAction: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { waitedSeconds: null } })) }));
vi.mock("@/app/(app)/funil/actions", () => ({ sendMessageAction, sendMediaAction: vi.fn() }));
vi.mock("@/app/(app)/conversa/actions", () => ({ addNoteAction: vi.fn(), scheduleMessageAction: vi.fn(), sendQuickReplyAction: vi.fn() }));
import { Composer } from "./composer";
import { loadSavedDraft, saveDraft } from "./composer-draft";
import { newVersionKnown, resetVersionState } from "@/components/shell/version-state";

beforeEach(() => { window.localStorage.clear(); resetVersionState(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const tela = (dealId = "d1") => render(<Composer dealId={dealId} firstName="Maria" quickReplies={[]} onOptimistic={() => {}} />);

describe("rascunho guardado (20/10: a tela recarregava e a atendente perdia o texto)", () => {
  it("o que foi digitado volta quando a conversa abre de novo, e só nessa conversa", () => {
    const a = tela("d1");
    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "Oi Maria, tudo bem? Sobre o seu horário…" } });
    a.unmount();
    tela("d1");
    expect((screen.getByLabelText("Mensagem") as HTMLTextAreaElement).value).toBe("Oi Maria, tudo bem? Sobre o seu horário…");
    cleanup();
    tela("d2");
    expect((screen.getByLabelText("Mensagem") as HTMLTextAreaElement).value).toBe("");
  });
  it("apagar o campo apaga o rascunho; mais de 3 dias também some", () => {
    saveDraft("d9", "texto", 1_000);
    expect(loadSavedDraft("d9", 1_000 + 86_400_000)).toBe("texto");
    expect(loadSavedDraft("d9", 1_000 + 4 * 86_400_000)).toBe("");
    saveDraft("d9", "outro");
    saveDraft("d9", "  ");
    expect(loadSavedDraft("d9")).toBe("");
  });
  it("navegador sem armazenamento não quebra a caixa", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("bloqueado"); });
    tela();
    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "oi" } });
    expect((screen.getByLabelText("Mensagem") as HTMLTextAreaElement).value).toBe("oi");
    spy.mockRestore();
  });
  it("depois de enviar, o rascunho some", async () => {
    tela();
    const field = screen.getByLabelText("Mensagem");
    fireEvent.change(field, { target: { value: "Posso confirmar?" } });
    expect(loadSavedDraft("d1")).toBe("Posso confirmar?");
    await new Promise((r) => setTimeout(r, 500));
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(sendMessageAction).toHaveBeenCalled());
    await waitFor(() => expect(loadSavedDraft("d1")).toBe(""));
  });
  it("envio sem resposta em 20 s: o texto volta para o campo e dá para tentar de novo (20/10, botão cinza da Cati)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    sendMessageAction.mockImplementationOnce(() => new Promise(() => {}) as never);
    tela("d7");
    const field = screen.getByLabelText("Mensagem") as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "Oi Julia" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(sendMessageAction).toHaveBeenCalled());
    expect(field.value).toBe("");
    await vi.advanceTimersByTimeAsync(20_500);
    await waitFor(() => expect(field.value).toBe("Oi Julia"));
    vi.useRealTimers();
  });
  it("envio que cai na troca de versão (Failed to find Server Action): o texto volta, fica guardado para depois de Atualizar e aparece o aviso", async () => {
    sendMessageAction.mockImplementationOnce(async () => { throw Object.assign(new Error('Server Action "40ab" was not found on the server.'), { name: "UnrecognizedActionError" }); });
    const a = tela("d5");
    const field = screen.getByLabelText("Mensagem") as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "Oi Julia, seu horário é amanhã" } });
    await new Promise((r) => setTimeout(r, 500));
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(field.value).toBe("Oi Julia, seu horário é amanhã"));
    expect(newVersionKnown()).toBe(true);
    await waitFor(() => expect(loadSavedDraft("d5")).toBe("Oi Julia, seu horário é amanhã"));
    // "Atualizar" recarrega a página: a caixa da mesma conversa abre com o texto.
    a.unmount();
    tela("d5");
    expect((screen.getByLabelText("Mensagem") as HTMLTextAreaElement).value).toBe("Oi Julia, seu horário é amanhã");
  });
});
