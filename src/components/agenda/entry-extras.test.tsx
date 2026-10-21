// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/app/(app)/agenda/profissional-actions", () => ({
  entryExtrasAction: vi.fn(async () => ({ ok: true, data: { finishedBy: "Maiara", canNote: true, notes: [{ id: "n1", body: "Alérgica a amônia", at: "2026-10-15T12:00:00.000Z", author: "Cati", hasPhoto: false }], link: { activity: "Confirmou pelo link hoje 10:42", canCreate: true } } })),
  addNoteForProAction: vi.fn(),
}));
vi.mock("@/app/(app)/agenda/actions", () => ({ createClientLinkAction: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { EntryExtras } from "./entry-extras";

afterEach(cleanup);

it("card do horário: Finalizado por Ana, a ficha técnica, o que a cliente fez pelo link e os botões Anotar e Copiar link", async () => {
  render(<EntryExtras appointmentId="00000000-0000-4000-8000-000000000001" />);
  expect(await screen.findByText("Finalizado por Maiara")).toBeTruthy();
  expect(screen.getByText("Alérgica a amônia")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Anotar para a profissional" })).toBeTruthy();
  expect(screen.getByText("Confirmou pelo link hoje 10:42")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Copiar link" })).toBeTruthy();
});
