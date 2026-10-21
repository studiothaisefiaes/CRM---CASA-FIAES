// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { createQuickReplyAction, makeQuickReplyUniversalAction } = vi.hoisted(() => ({
  createQuickReplyAction: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { id: "n1" } })),
  makeQuickReplyUniversalAction: vi.fn(async (..._a: unknown[]) => ({ ok: true as const })),
}));
vi.mock("@/app/(app)/config/actions", () => ({ addListItemAction: vi.fn(), setKeywordBoostAction: vi.fn(), updateListItemAction: vi.fn(), saveServiceCycleDaysAction: vi.fn() }));
vi.mock("@/app/(app)/config/listas/actions", () => ({ saveServiceDetailsAction: vi.fn() }));
vi.mock("@/app/(app)/config/respostas/actions", () => ({ attachQuickReplyFileAction: vi.fn(), detachQuickReplyFileAction: vi.fn(), setQuickReplyFolderAction: vi.fn() }));
vi.mock("@/app/(app)/conversa/actions", () => ({ createQuickReplyAction, makeQuickReplyUniversalAction }));
import { ListsEditor } from "./lists";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const base = { kind: "quick_reply" as const, active: true, cycleDays: null, category: null, attachment: null };
const items = [
  { ...base, id: "u1", label: "boas-vindas", body: "Oi!", ownerName: null },
  { ...base, id: "p1", label: "jeito-sara", body: "Oi, sou a Sara", ownerName: "Sara Lima" },
];

describe("Configurações › Respostas prontas: universal e pessoal", () => {
  it("a pessoal mostra de quem é e a gestão transforma em universal", async () => {
    render(<ListsEditor items={items} />);
    expect(screen.getByText("Só de Sara Lima")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Tornar universal/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Tornar universal /jeito-sara" }));
    await waitFor(() => expect(makeQuickReplyUniversalAction).toHaveBeenCalledWith("p1"));
  });
  it("adicionar: botões de variável, prévia com exemplo e escolha de quem usa", async () => {
    render(<ListsEditor items={items} />);
    const form = screen.getByRole("form", { name: "Adicionar" });
    fireEvent.change(within(form).getByLabelText("Nome"), { target: { value: "confirmar" } });
    const body = within(form).getByLabelText("Texto da resposta") as HTMLTextAreaElement;
    fireEvent.change(body, { target: { value: "Oi, " } });
    body.setSelectionRange(4, 4);
    fireEvent.click(within(form).getByRole("button", { name: "Primeiro nome" }));
    expect(body.value).toBe("Oi, {primeiro_nome}");
    expect(within(form).getByTestId("previa-resposta").textContent).toBe("Oi, Ana");
    fireEvent.click(within(form).getByLabelText(/Só minha/));
    fireEvent.click(within(form).getByRole("button", { name: "Adicionar" }));
    await waitFor(() => expect(createQuickReplyAction).toHaveBeenCalledWith({ label: "confirmar", body: "Oi, {primeiro_nome}", scope: "minha", folder: null }));
  });
});
