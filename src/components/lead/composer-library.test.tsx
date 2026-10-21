// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/app/(app)/funil/actions", () => ({ sendMessageAction: vi.fn(), sendMediaAction: vi.fn() }));
vi.mock("@/app/(app)/conversa/actions", () => ({ addNoteAction: vi.fn(), scheduleMessageAction: vi.fn(), sendQuickReplyAction: vi.fn(), sendLibraryFileAction: vi.fn(), listLibraryAction: vi.fn(async () => ({ ok: true, data: { items: [], tags: [] } })) }));
import { Composer } from "./composer";

afterEach(cleanup);
const open = (libraryEnabled: boolean) => {
  render(<Composer dealId="d1" firstName="Maria" quickReplies={[]} onOptimistic={() => {}} libraryEnabled={libraryEnabled} />);
  fireEvent.click(screen.getByRole("button", { name: "Anexar e mais" }));
};

describe("clipe › Da biblioteca", () => {
  it("com a Biblioteca ligada, o menu do clipe oferece “Da biblioteca” e abre o seletor", async () => {
    open(true);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Da biblioteca" }));
    expect(await screen.findByRole("dialog", { name: "Qual arquivo da Biblioteca você quer mandar?" })).toBeTruthy();
  });
  it("desligada ou sem permissão: o item some", async () => {
    open(false);
    await screen.findByRole("menuitem", { name: "Foto ou arquivo" });
    expect(screen.queryByRole("menuitem", { name: "Da biblioteca" })).toBeNull();
  });
});
