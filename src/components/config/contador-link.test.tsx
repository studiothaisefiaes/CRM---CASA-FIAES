// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  create: vi.fn(async () => ({ ok: true as const, data: { id: "l1", url: "https://crm.casafiaes.com.br/convite/segredo", expiresAt: "2026-11-02T15:00:00.000Z" } })),
  revoke: vi.fn(async (_id: string) => ({ ok: true as const })),
}));
vi.mock("@/app/(app)/config/actions", () => ({ createContadorLinkAction: () => h.create(), revokeContadorLinkAction: (id: string) => h.revoke(id) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { ContadorLinkPanel } from "./contador-link";

afterEach(cleanup);

it("gera o link, mostra uma vez com Copiar (vale uma vez, 7 dias)", async () => {
  const writeText = vi.fn(async () => {});
  Object.assign(navigator, { clipboard: { writeText } });
  render(<ContadorLinkPanel pending={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "Gerar link para o contador" }));
  await waitFor(() => expect((screen.getByLabelText("Endereço do link") as HTMLInputElement).value).toBe("https://crm.casafiaes.com.br/convite/segredo"));
  expect(screen.getByText(/não aparece de novo/)).toBeTruthy();
  expect(screen.getByText(/Vale uma vez, até 02\/11/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Copiar" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://crm.casafiaes.com.br/convite/segredo"));
});

it("lista os links que ainda valem e revoga", async () => {
  render(<ContadorLinkPanel pending={[{ id: "l9", createdAt: "2026-10-26T13:00:00.000Z", expiresAt: "2026-11-02T13:00:00.000Z", createdByName: "Thaise" }]} />);
  expect(screen.getByRole("list", { name: "Links do contador ainda valendo" }).textContent).toContain("por Thaise");
  fireEvent.click(screen.getByRole("button", { name: /Revogar o link gerado em 26\/10/ }));
  await waitFor(() => expect(h.revoke).toHaveBeenCalledWith("l9"));
});
