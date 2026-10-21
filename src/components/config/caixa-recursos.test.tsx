// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CAIXA_RECURSOS_PADRAO, RECIBO_TEXTO_SUGERIDO, RECURSO_KEYS, RECURSO_LABEL } from "@/lib/caixa-recursos";

const saveCaixaRecursosAction = vi.fn(async (_v: unknown) => ({ ok: true }));
vi.mock("@/app/(app)/caixa/actions", () => ({ saveCaixaRecursosAction: (v: unknown) => saveCaixaRecursosAction(v) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { CaixaRecursosForm } from "./caixa-recursos";

afterEach(() => { cleanup(); saveCaixaRecursosAction.mockClear(); });

it("mostra os 8 rótulos, os links e salva o objeto inteiro", async () => {
  render(<CaixaRecursosForm value={CAIXA_RECURSOS_PADRAO} />);
  for (const k of RECURSO_KEYS) expect(screen.getByRole("switch", { name: RECURSO_LABEL[k] })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Taxas do cartão" }).getAttribute("href")).toBe("/servicos?aba=formas");
  expect(screen.getByRole("link", { name: "Como calcular a comissão" }).getAttribute("href")).toBe("/caixa/comissao?aba=regras");
  fireEvent.click(screen.getByRole("switch", { name: "Taxa do cartão" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar" })); });
  expect(saveCaixaRecursosAction).toHaveBeenCalledWith({ ...CAIXA_RECURSOS_PADRAO, taxaCartao: false });
});
it("'Usar o texto sugerido' devolve o texto", () => {
  render(<CaixaRecursosForm value={{ ...CAIXA_RECURSOS_PADRAO, reciboTexto: "Outro" }} />);
  const box = screen.getByLabelText("Texto do recibo") as HTMLTextAreaElement;
  expect(box.value).toBe("Outro");
  fireEvent.click(screen.getByRole("button", { name: "Usar o texto sugerido" }));
  expect(box.value).toBe(RECIBO_TEXTO_SUGERIDO);
});
it("'Pagar comissão a partir de': a data vai no objeto salvo; apagar volta a sem corte", async () => {
  render(<CaixaRecursosForm value={{ ...CAIXA_RECURSOS_PADRAO, pagarComissaoDesde: "2026-09-15" }} />);
  const box = screen.getByLabelText("Pagar comissão a partir de") as HTMLInputElement;
  expect(box.value).toBe("2026-09-15");
  expect(screen.getByText("Comandas antes desta data não entram no A pagar, para não pagar de novo o que já foi pago fora do CRM.")).toBeTruthy();
  fireEvent.change(box, { target: { value: "" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar" })); });
  expect(saveCaixaRecursosAction).toHaveBeenCalledWith({ ...CAIXA_RECURSOS_PADRAO, pagarComissaoDesde: null });
});
