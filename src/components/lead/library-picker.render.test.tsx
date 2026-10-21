// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const items = [
  { id: "f1", name: "Tabela", caption: "Tabela de preços", tags: ["Preços"], kind: "image", sizeBytes: 1000, thumbUrl: "/api/biblioteca/f1?thumb=1" },
  { id: "f2", name: "Como chegar", caption: null, tags: ["Como chegar"], kind: "document", sizeBytes: 2000, thumbUrl: null },
];
const { listLibraryAction, sendLibraryFileAction } = vi.hoisted(() => ({
  listLibraryAction: vi.fn(),
  sendLibraryFileAction: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { waitedSeconds: null } })),
}));
vi.mock("@/app/(app)/conversa/actions", () => ({ listLibraryAction, sendLibraryFileAction }));
import { LibraryPicker } from "./library-picker";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const open = async (onSent = () => {}, onClose = () => {}) => {
  listLibraryAction.mockResolvedValue({ ok: true, data: { items, tags: ["Preços", "Como chegar"] } });
  render(<LibraryPicker dealId="d1" open onClose={onClose} onSent={onSent} />);
  await screen.findByText("Tabela");
};

describe("Da biblioteca", () => {
  it("abre com as abas das etiquetas e a miniatura", async () => {
    await open();
    expect(screen.getByRole("radiogroup", { name: "Etiquetas" })).toBeTruthy();
    for (const t of ["Todas", "Preços", "Como chegar"]) expect(screen.getByRole("radio", { name: t })).toBeTruthy();
    expect(screen.getByAltText("Miniatura de Tabela").getAttribute("src")).toBe("/api/biblioteca/f1?thumb=1");
    expect(screen.getByText("Como chegar", { selector: "span.font-medium" })).toBeTruthy();
  });
  it("a aba filtra pela etiqueta", async () => {
    await open();
    fireEvent.click(screen.getByRole("radio", { name: "Preços" }));
    expect(screen.queryByRole("button", { name: "Enviar Como chegar" })).toBeNull();
    expect(screen.getByRole("button", { name: "Enviar Tabela" })).toBeTruthy();
  });
  it("Enviar em um toque chama sendLibraryFileAction com a legenda da Biblioteca", async () => {
    const onSent = vi.fn(), onClose = vi.fn();
    await open(onSent, onClose);
    fireEvent.click(screen.getByRole("button", { name: "Enviar Tabela" }));
    await waitFor(() => expect(sendLibraryFileAction).toHaveBeenCalledWith("d1", "f1", "Tabela de preços"));
    await waitFor(() => expect(onSent).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });
  it("função desligada ou sem permissão: mostra o motivo e nada para enviar", async () => {
    listLibraryAction.mockResolvedValue({ ok: false, error: "Biblioteca está desligada em Configurações › Recursos." });
    render(<LibraryPicker dealId="d1" open onClose={() => {}} />);
    expect((await screen.findByRole("alert")).textContent).toContain("desligada");
    expect(screen.queryByRole("button", { name: /Enviar/ })).toBeNull();
  });
});
