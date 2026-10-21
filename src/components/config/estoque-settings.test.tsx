// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const salvar = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
vi.mock("@/app/(app)/config/estoque/actions", () => ({ salvarEstoqueConfig: (...a: unknown[]) => salvar(...a) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { EstoqueSettingsForm } from "./estoque-settings";

afterEach(cleanup);

it("a pergunta da tela, a chave e os três padrões; salva o que mudou", async () => {
  render(<EstoqueSettingsForm config={{ ligado: true, cfopPadrao: "5102", csosnPadrao: "102", unidadePadrao: "UN" }} />);
  expect(screen.getByRole("heading", { name: "Como a Casa controla os produtos?" })).toBeTruthy();
  expect(screen.getByText(/Desligado, o produto na comanda volta a ser texto livre e o estoque não baixa/)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Salvar" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("switch", { name: "Produtos e estoque" }));
  fireEvent.change(screen.getByLabelText("CFOP"), { target: { value: "5405" } });
  fireEvent.change(screen.getByLabelText("CSOSN"), { target: { value: "500" } });
  fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "ml" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar" })); });
  expect(salvar).toHaveBeenCalledWith({ ligado: false, cfopPadrao: "5405", csosnPadrao: "500", unidadePadrao: "ml" });
});
