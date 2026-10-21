// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const setCommissionAction = vi.fn(async () => ({ ok: true }));
const applyCommissionCategoryAction = vi.fn(async () => ({ ok: true, data: { updated: 2 } }));
const saveProCommissionRulesAction = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
const setAssistantCommissionAction = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
const toast = vi.fn();
vi.mock("@/app/(app)/caixa/comissao/actions", () => ({
  saveProCommissionRulesAction: (...a: unknown[]) => saveProCommissionRulesAction(...a),
  setAssistantCommissionAction: (...a: unknown[]) => setAssistantCommissionAction(...a),
}));
vi.mock("@/app/(app)/caixa/actions", () => ({
  setCommissionAction: (...a: unknown[]) => (setCommissionAction as (...x: unknown[]) => unknown)(...a),
  applyCommissionCategoryAction: (...a: unknown[]) => (applyCommissionCategoryAction as (...x: unknown[]) => unknown)(...a),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { CommissionRules } from "./commission-rules";
import { DEDUCT_LABEL } from "@/lib/commission-rules";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const ROWS = [{ professionalId: "p1", name: "Ana", active: true, rules: null, services: [
  { serviceId: "s1", label: "Corte", category: "Cabelo", bp: 4000, assistantBp: 1000 }, { serviceId: "s2", label: "Hidratação", category: "Cabelo", bp: null, assistantBp: null }, { serviceId: "s3", label: "Manicure", category: "Unhas", bp: null, assistantBp: null },
] }];
const CASA = { cartao: "antes", antecipacao: "antes", antecipacaoBp: 700, custo: "depois", doisAssistentes: "metade", assistenteSaiDaPrincipalBp: 10000, divida: "quitacao" } as const;

it("% por serviço (vazio = sem regra); texto inválido avisa; aplicar à categoria", async () => {
  render(<CommissionRules rows={ROWS} casa={CASA} />);
  const ana = screen.getByRole("region", { name: "Comissão de Ana" });
  expect((within(ana).getByLabelText("Corte (%)") as HTMLInputElement).value).toBe("40");
  fireEvent.change(within(ana).getByLabelText("Hidratação (%)"), { target: { value: "35,5" } });
  await act(async () => { fireEvent.blur(within(ana).getByLabelText("Hidratação (%)")); });
  expect(setCommissionAction).toHaveBeenCalledWith({ professionalId: "p1", serviceId: "s2", bp: 3550 });
  fireEvent.change(within(ana).getByLabelText("Corte (%)"), { target: { value: "120" } });
  await act(async () => { fireEvent.blur(within(ana).getByLabelText("Corte (%)")); });
  expect(toast).toHaveBeenCalledWith("Use de 0% a 100%.", "error");
  fireEvent.change(within(ana).getByLabelText("% para todos de Unhas"), { target: { value: "30" } });
  await act(async () => { fireEvent.click(within(ana).getByRole("button", { name: "Aplicar a Unhas" })); });
  expect(applyCommissionCategoryAction).toHaveBeenCalledWith({ professionalId: "p1", category: "Unhas", bp: 3000 });
});

it("cada serviço tem '%' e '% da assistente' (vazio = sem regra); mudar o da assistente salva só ele", async () => {
  render(<CommissionRules rows={ROWS} casa={CASA} />);
  const ana = screen.getByRole("region", { name: "Comissão de Ana" });
  expect((within(ana).getByLabelText("Corte (% da assistente)") as HTMLInputElement).value).toBe("10");
  expect((within(ana).getByLabelText("Hidratação (% da assistente)") as HTMLInputElement).value).toBe("");
  fireEvent.change(within(ana).getByLabelText("Hidratação (% da assistente)"), { target: { value: "12,5" } });
  await act(async () => { fireEvent.blur(within(ana).getByLabelText("Hidratação (% da assistente)")); });
  expect(setAssistantCommissionAction).toHaveBeenCalledWith({ professionalId: "p1", serviceId: "s2", bp: 1250 });
  expect(setCommissionAction).not.toHaveBeenCalled();
  fireEvent.change(within(ana).getByLabelText("Corte (% da assistente)"), { target: { value: "abc" } });
  await act(async () => { fireEvent.blur(within(ana).getByLabelText("Corte (% da assistente)")); });
  expect(toast).toHaveBeenCalledWith("Use de 0% a 100%.", "error");
});

it("cada profissional segue a Casa ou tem regra própria; a própria salva os três descontos", async () => {
  render(<CommissionRules rows={ROWS} casa={CASA} />);
  const ana = screen.getByRole("region", { name: "Comissão de Ana" });
  const modo = within(ana).getByRole("radiogroup", { name: "Regra de Ana" });
  expect(modo.querySelector('[aria-checked="true"]')?.textContent).toBe("Segue a Casa");
  expect(within(ana).queryByRole("radiogroup", { name: "Taxa do cartão de Ana" })).toBeNull();
  fireEvent.click(within(modo).getByRole("radio", { name: "Regra própria" }));
  // começa pela regra da Casa; muda só o custo
  fireEvent.click(within(within(ana).getByRole("radiogroup", { name: "Custo do serviço de Ana" })).getByRole("radio", { name: DEDUCT_LABEL.nao }));
  await act(async () => { fireEvent.click(within(ana).getByRole("button", { name: "Salvar a regra de Ana" })); });
  expect(saveProCommissionRulesAction).toHaveBeenCalledWith("p1", { cartao: "antes", antecipacao: "antes", custo: "nao" });
});

it("voltar a 'Segue a Casa' salva null", async () => {
  const propria = [{ ...ROWS[0], rules: { cartao: "nao" as const } }];
  render(<CommissionRules rows={propria} casa={CASA} />);
  const ana = screen.getByRole("region", { name: "Comissão de Ana" });
  expect(within(within(ana).getByRole("radiogroup", { name: "Taxa do cartão de Ana" })).getByRole("radio", { checked: true }).textContent).toBe(DEDUCT_LABEL.nao);
  fireEvent.click(within(within(ana).getByRole("radiogroup", { name: "Regra de Ana" })).getByRole("radio", { name: "Segue a Casa" }));
  await act(async () => { fireEvent.click(within(ana).getByRole("button", { name: "Salvar a regra de Ana" })); });
  expect(saveProCommissionRulesAction).toHaveBeenCalledWith("p1", null);
});

it("'Assistente na comanda' desligado: a coluna fica e um aviso curto explica", () => {
  const { rerender } = render(<CommissionRules rows={ROWS} casa={CASA} />);
  expect(screen.queryByText(/Assistente na comanda está desligado/)).toBeNull();
  rerender(<CommissionRules rows={ROWS} casa={CASA} assistentesLigado={false} />);
  expect(screen.getByRole("status").textContent).toMatch(/Assistente na comanda está desligado em Configurações › Caixa/);
  expect(screen.getByLabelText("Corte (% da assistente)")).toBeTruthy();
});
