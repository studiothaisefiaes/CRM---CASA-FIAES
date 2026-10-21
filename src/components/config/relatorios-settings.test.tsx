// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const salvar = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
vi.mock("@/app/(app)/config/relatorios/actions", () => ({ salvarRelatoriosConfig: (...a: unknown[]) => salvar(...a) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { RelatoriosSettingsForm } from "./relatorios-settings";

afterEach(cleanup);

it("a pergunta da tela e a chave da Ocupação; salva o que mudou", async () => {
  render(<RelatoriosSettingsForm config={{ ocupacao: true }} />);
  expect(screen.getByRole("heading", { name: "O que os Relatórios mostram?" })).toBeTruthy();
  expect((screen.getByRole("button", { name: "Salvar" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("switch", { name: "Ocupação (mapa de calor e ocupação por profissional)" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar" })); });
  expect(salvar).toHaveBeenCalledWith({ ocupacao: false });
});
