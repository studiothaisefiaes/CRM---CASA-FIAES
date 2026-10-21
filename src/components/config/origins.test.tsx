// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
vi.mock("@/app/(app)/config/actions", () => ({
  addListItemAction: vi.fn(async () => ({ ok: true })), updateListItemAction: vi.fn(async () => ({ ok: true })), setKeywordBoostAction: vi.fn(),
  saveServiceCycleDaysAction: vi.fn(), createSourceAction: vi.fn(async () => ({ ok: true })), setSourceActiveAction: vi.fn(),
}));
vi.mock("@/app/(app)/config/listas/actions", () => ({ saveServiceDetailsAction: vi.fn() }));
vi.mock("@/app/(app)/config/respostas/actions", () => ({ attachQuickReplyFileAction: vi.fn(), detachQuickReplyFileAction: vi.fn(), setQuickReplyFolderAction: vi.fn() })); // Lote 5: respostas prontas na mesma lista
vi.mock("@/app/(app)/conversa/actions", () => ({ createQuickReplyAction: vi.fn(), makeQuickReplyUniversalAction: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { SimpleOrigins } from "./origins";
import { ListsEditor } from "./lists";

afterEach(cleanup);

it("origens numa lista só: a que já tem link aparece assim; 'Criar link e QR' abre a origem com link já com o nome", () => {
  render(<SimpleOrigins items={[{ id: "o1", label: "Instagram", active: true }, { id: "o2", label: "Indicação", active: true }]} linked={["indicacao"]} />);
  expect(screen.getByText("Tem link e QR")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Criar link e QR para Indicação" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Criar link e QR para Instagram" }));
  expect((screen.getByLabelText("Nome") as HTMLInputElement).value).toBe("Instagram");
});

it("Listas e respostas não tem mais as abas Origens nem Serviços (Serviços virou aba do menu)", () => {
  render(<ListsEditor items={[]} />);
  expect(screen.queryByRole("tab", { name: "Origens" })).toBeNull();
  expect(screen.queryByRole("tab", { name: "Serviços" })).toBeNull();
  expect(screen.getByRole("tab", { name: "Palavras-chave" })).toBeTruthy();
});
