// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const save = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
const toast = vi.fn();
vi.mock("@/app/(app)/caixa/comissao/actions", () => ({ saveCommissionRulesAction: (...a: unknown[]) => save(...a) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { CommissionHow } from "./commission-how";
import { DEDUCT_LABEL, type CommissionRules } from "@/lib/commission-rules";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const CASA: CommissionRules = { cartao: "antes", antecipacao: "antes", antecipacaoBp: 700, custo: "depois", doisAssistentes: "metade", assistenteSaiDaPrincipalBp: 10000, divida: "quitacao" };

it("mostra cada pergunta com o valor de hoje; cada desconto tem as três opções", () => {
  render(<CommissionHow rules={CASA} />);
  for (const nome of ["Taxa do cartão", "Antecipação (7%)", "Custo do serviço"]) {
    const g = within(screen.getByRole("radiogroup", { name: nome }));
    expect(g.getAllByRole("radio").map((r) => r.textContent)).toEqual([DEDUCT_LABEL.nao, DEDUCT_LABEL.antes, DEDUCT_LABEL.depois]);
  }
  expect(within(screen.getByRole("radiogroup", { name: "Taxa do cartão" })).getByRole("radio", { checked: true }).textContent).toBe(DEDUCT_LABEL.antes);
  expect(within(screen.getByRole("radiogroup", { name: "Custo do serviço" })).getByRole("radio", { checked: true }).textContent).toBe(DEDUCT_LABEL.depois);
  const duas = within(screen.getByRole("radiogroup", { name: "Duas assistentes" }));
  expect(duas.getAllByRole("radio").map((r) => r.textContent)).toEqual(["Sobre o total", "Metade"]);
  expect(duas.getByRole("radio", { checked: true }).textContent).toBe("Metade");
  expect((screen.getByLabelText("Quanto da assistente sai da principal") as HTMLInputElement).value).toBe("100");
  const div = within(screen.getByRole("radiogroup", { name: "Comissão de comanda com dívida" }));
  expect(div.getAllByRole("radio").map((r) => r.textContent)).toEqual(["Na hora", "Quando ela pagar"]);
  expect(div.getByRole("radio", { checked: true }).textContent).toBe("Quando ela pagar");
});

it("salvar manda o objeto inteiro com o que foi mudado", async () => {
  render(<CommissionHow rules={CASA} />);
  fireEvent.click(within(screen.getByRole("radiogroup", { name: "Taxa do cartão" })).getByRole("radio", { name: DEDUCT_LABEL.nao }));
  fireEvent.click(within(screen.getByRole("radiogroup", { name: "Duas assistentes" })).getByRole("radio", { name: "Sobre o total" }));
  fireEvent.click(within(screen.getByRole("radiogroup", { name: "Comissão de comanda com dívida" })).getByRole("radio", { name: "Na hora" }));
  fireEvent.change(screen.getByLabelText("Taxa de antecipação (%)"), { target: { value: "6,5" } });
  fireEvent.change(screen.getByLabelText("Quanto da assistente sai da principal"), { target: { value: "50" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar regras" })); });
  expect(save).toHaveBeenCalledWith({ cartao: "nao", antecipacao: "antes", antecipacaoBp: 650, custo: "depois", doisAssistentes: "total", assistenteSaiDaPrincipalBp: 5000, divida: "agora" });
});

it("percentual inválido avisa e não salva", async () => {
  render(<CommissionHow rules={CASA} />);
  fireEvent.change(screen.getByLabelText("Taxa de antecipação (%)"), { target: { value: "120" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar regras" })); });
  expect(toast).toHaveBeenCalledWith("Use de 0% a 100%.", "error");
  expect(save).not.toHaveBeenCalled();
});

it("erro do servidor aparece; quem não pode mudar só lê", async () => {
  save.mockResolvedValueOnce({ ok: false, error: "Você não tem permissão para isso." } as never);
  render(<CommissionHow rules={CASA} />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar regras" })); });
  expect(toast).toHaveBeenCalledWith("Você não tem permissão para isso.", "error");
});

it("com 'Comissão com taxa, antecipação e custo' desligado: aviso curto, campos continuam editáveis", () => {
  const { rerender } = render(<CommissionHow rules={CASA} />);
  expect(screen.queryByText(/desligada em Configurações › Caixa/)).toBeNull();
  rerender(<CommissionHow rules={CASA} descontosLigados={false} />);
  expect(screen.getByRole("status").textContent).toMatch(/desligada em Configurações › Caixa/);
  expect((within(screen.getByRole("radiogroup", { name: "Taxa do cartão" })).getAllByRole("radio")[0] as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole("button", { name: "Salvar regras" }) as HTMLButtonElement).disabled).toBe(false);
});
