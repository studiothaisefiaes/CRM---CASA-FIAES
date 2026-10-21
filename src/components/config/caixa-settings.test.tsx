// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const saveCaixaSettingsAction = vi.fn(async () => ({ ok: true }));
vi.mock("@/app/(app)/caixa/actions", () => ({ saveCaixaSettingsAction: (...a: unknown[]) => (saveCaixaSettingsAction as (...x: unknown[]) => unknown)(...a) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { CaixaSettingsForm } from "./caixa-settings";

afterEach(cleanup);

it("modo Avec ou CRM e 'Exigir caixa aberto para fechar comanda'; atalhos para Pacotes e Comissão", async () => {
  render(<CaixaSettingsForm mode="avec" exigeCaixaAberto={false} />);
  expect(screen.getByRole("link", { name: "Pacotes à venda" }).getAttribute("href")).toBe("/servicos?aba=pacotes"); // Plano 5: o catálogo fica só em Serviços e pacotes
  expect(screen.getByRole("link", { name: "Regras de comissão" }).getAttribute("href")).toBe("/caixa/comissao?aba=regras");
  fireEvent.click(screen.getByRole("radio", { name: /No CRM/ }));
  fireEvent.click(screen.getByRole("switch", { name: "Exigir caixa aberto para fechar comanda" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar" })); });
  expect(saveCaixaSettingsAction).toHaveBeenCalledWith({ mode: "crm", exigeCaixaAberto: true });
});
