// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const salvar = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
vi.mock("@/app/(app)/config/financeiro/actions", () => ({ salvarFinanceiroConfig: (...a: unknown[]) => salvar(...a) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { FinanceiroSettingsForm } from "./financeiro-settings";

afterEach(cleanup);

it("a pergunta da tela, as duas chaves e os dois números; salva o que mudou", async () => {
  render(<FinanceiroSettingsForm config={{ contasAPagar: true, resultado: true, venceEmDias: 7, repetirMaxMeses: 24 }} />);
  expect(screen.getByRole("heading", { name: "Como a Casa controla as contas?" })).toBeTruthy();
  expect((screen.getByRole("button", { name: "Salvar" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("switch", { name: "Contas a pagar" }));
  fireEvent.click(screen.getByRole("switch", { name: "Resultado (fluxo de caixa e DRE)" }));
  fireEvent.change(screen.getByLabelText("Avisar vencimento com quantos dias"), { target: { value: "10" } });
  fireEvent.change(screen.getByLabelText("Repetir despesa por até quantos meses"), { target: { value: "12" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar" })); });
  expect(salvar).toHaveBeenCalledWith({ contasAPagar: false, resultado: false, venceEmDias: 10, repetirMaxMeses: 12 });
});
