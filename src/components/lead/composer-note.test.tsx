// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// vi.hoisted: os vi.mock sobem para o topo do arquivo; sem isso a fábrica do mock lê as funções antes de existirem.
const { addNoteAction, sendMessageAction } = vi.hoisted(() => ({
  addNoteAction: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { id: "n1" } })),
  sendMessageAction: vi.fn(),
}));
vi.mock("@/app/(app)/conversa/actions", () => ({ addNoteAction, scheduleMessageAction: vi.fn(), sendQuickReplyAction: vi.fn() }));
vi.mock("@/app/(app)/funil/actions", () => ({ sendMessageAction, sendMediaAction: vi.fn() }));
import { Composer } from "./composer";

const wide = (on: boolean) => { window.matchMedia = ((q: string) => ({ matches: on, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia; };
beforeEach(() => wide(true));
afterEach(() => { cleanup(); vi.clearAllMocks(); wide(false); });
const team = [{ id: "u1", name: "Catarina Rocha" }, { id: "u2", name: "Sara Lima" }];

describe("campo da conversa: nota interna", () => {
  it("modo Nota chama a colega com @ e salva a nota (nada vai para a cliente)", async () => {
    const saved = vi.fn();
    render(<Composer dealId="d1" firstName="Maria" quickReplies={[]} onOptimistic={() => {}} team={team} onNoteSaved={saved} />);
    fireEvent.click(screen.getByRole("button", { name: "Nota para a equipe (a cliente não vê)" }));
    const field = screen.getByLabelText("Nota interna");
    fireEvent.change(field, { target: { value: "Confere o sinal @ca" } });
    expect(screen.getByRole("listbox", { name: "Chamar alguém da equipe" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /@Catarina/ }));
    expect((field as HTMLTextAreaElement).value).toBe("Confere o sinal @Catarina ");
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(addNoteAction).toHaveBeenCalledWith({ dealId: "d1", body: "Confere o sinal @Catarina", mentions: ["u1"] }));
    expect(sendMessageAction).not.toHaveBeenCalled();
    await waitFor(() => expect(saved).toHaveBeenCalled());
  });
  it("no modo Nota não há anexo, gravação nem resposta pronta", () => {
    render(<Composer dealId="d1" firstName="Maria" quickReplies={[{ id: "q", label: "oi", body: "Oi!" }]} onOptimistic={() => {}} team={team} />);
    fireEvent.click(screen.getByRole("button", { name: "Nota para a equipe (a cliente não vê)" }));
    expect(screen.queryByRole("button", { name: "Anexar foto, PDF ou áudio" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Nota interna"), { target: { value: "/oi" } });
    expect(screen.queryByRole("listbox", { name: "Respostas prontas" })).toBeNull();
  });
});
