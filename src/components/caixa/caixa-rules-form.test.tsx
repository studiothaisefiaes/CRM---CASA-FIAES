// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const saveCaixaRulesAction = vi.fn(async () => ({ ok: true }));
vi.mock("@/app/(app)/caixa/actions", () => ({ saveCaixaRulesAction: (...a: unknown[]) => (saveCaixaRulesAction as (...x: unknown[]) => unknown)(...a) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));
import { CaixaRulesForm } from "./caixa-rules-form";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const rules = { exigeCaixaAberto: false, toleranciaCents: 500, contagemCega: true, sangriaGrandeCents: 20000, aprovacaoDescontoBp: null, notaPadrao: "sem_cpf" as const };

it("limite de cortesia e desconto (QA r58, I-11): vem desligado; ligado, pede o % e salva junto com as outras regras", async () => {
  render(<CaixaRulesForm rules={rules} />);
  const sw = screen.getByRole("switch", { name: "Cortesia ou desconto acima de um limite pede aprovação da gestão" });
  expect(sw.getAttribute("aria-checked")).toBe("false");
  expect(screen.queryByLabelText("Acima de (%)")).toBeNull();
  fireEvent.click(sw);
  fireEvent.change(screen.getByLabelText("Acima de (%)"), { target: { value: "20" } });
  expect(screen.getByText("Cortesia ou desconto acima de 20% pede aprovação da gestão.")).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar" })); });
  expect(saveCaixaRulesAction).toHaveBeenCalledWith({ toleranciaCents: 500, contagemCega: true, sangriaGrandeCents: 20000, aprovacaoDescontoBp: 2000, notaPadrao: "sem_cpf" });
});

it("psico r68 #3: 'Padrão da nota' é o primeiro campo, com Perguntar / Não emitir / Emitir sem CPF, e salva o escolhido", async () => {
  render(<CaixaRulesForm rules={{ ...rules, notaPadrao: "perguntar" }} />);
  const sel = screen.getByLabelText("Padrão da nota") as HTMLSelectElement;
  expect([...sel.options].map((o) => o.textContent)).toEqual(["Perguntar a cada comanda", "Não emitir", "Emitir sem CPF"]);
  const first = document.querySelector("section input, section select");
  expect(first).toBe(sel);
  fireEvent.change(sel, { target: { value: "nao" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar" })); });
  expect(saveCaixaRulesAction).toHaveBeenCalledWith(expect.objectContaining({ notaPadrao: "nao" }));
});
