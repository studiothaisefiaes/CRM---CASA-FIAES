// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ItemEditor, ProductPicker } from "./item-editor";

afterEach(cleanup);
const item = { id: "i1", label: "Corte", qty: 1, unitCents: 12000 as number | null, discountCents: 0, originalUnitCents: 12000 as number | null };

it("mudar um preço que já existia pede o motivo; sem motivo, Salvar fica desligado", () => {
  const onSave = vi.fn();
  render(<ItemEditor item={item} pending={false} onSave={onSave} onCancel={() => {}} />);
  expect(screen.queryByLabelText("Motivo")).toBeNull();
  fireEvent.change(screen.getByLabelText("Preço de Corte (R$)"), { target: { value: "100" } });
  expect(screen.getByLabelText("Motivo")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Salvar" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "cliente antiga" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
  expect(onSave).toHaveBeenCalledWith({ unitCents: 10000, reason: "cliente antiga" });
});

it("desconto em %: pede motivo e manda o percentual", () => {
  const onSave = vi.fn();
  render(<ItemEditor item={item} pending={false} onSave={onSave} onCancel={() => {}} />);
  fireEvent.click(screen.getByRole("radio", { name: "%" }));
  fireEvent.change(screen.getByLabelText("Desconto em Corte (%)"), { target: { value: "10" } });
  fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "primeira vez" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
  expect(onSave).toHaveBeenCalledWith({ discountPercent: 10, reason: "primeira vez" });
});

it("preencher um preço vazio não pede motivo", () => {
  const onSave = vi.fn();
  render(<ItemEditor item={{ ...item, label: "Mechas", unitCents: null, originalUnitCents: null }} pending={false} onSave={onSave} onCancel={() => {}} />);
  fireEvent.change(screen.getByLabelText("Preço de Mechas (R$)"), { target: { value: "300" } });
  expect(screen.queryByLabelText("Motivo")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
  expect(onSave).toHaveBeenCalledWith({ unitCents: 30000 });
});

it("preço alterado (QA r58, I-7): o Motivo mostra 'obrigatório' e o Salvar cinza diz o que falta, como no Registrar ligação", () => {
  render(<ItemEditor item={item} pending={false} onSave={() => {}} onCancel={() => {}} />);
  const save = screen.getByRole("button", { name: "Salvar" }) as HTMLButtonElement;
  const why = () => document.getElementById(save.getAttribute("aria-describedby") ?? "")?.textContent ?? null;
  expect(why()).toBe("Para salvar, mude o preço ou o desconto.");
  fireEvent.change(screen.getByLabelText("Preço de Corte (R$)"), { target: { value: "150" } });
  const motivo = screen.getByLabelText("Motivo") as HTMLInputElement;
  expect(motivo.getAttribute("aria-required")).toBe("true");
  expect(screen.getByText("obrigatório")).toBeTruthy();
  expect(save.disabled).toBe(true);
  expect(why()).toBe("Para salvar, escreva o motivo.");
  fireEvent.change(motivo, { target: { value: "cabelo mais longo" } });
  expect(save.disabled).toBe(false);
  expect(save.getAttribute("aria-describedby")).toBeNull();
  expect(screen.queryByText(/Para salvar/)).toBeNull();
});

const PRODS = [
  { id: "p1", name: "Shampoo Hidratante", priceCents: 5000, barcode: "7891234", stockQty: 4 },
  { id: "p2", name: "Máscara Reparadora", priceCents: 8900, barcode: null, stockQty: 0 },
];
it("escolha de produto: busca por nome (sem acento) ou código de barras, e o preço vem do catálogo", () => {
  const onPick = vi.fn();
  render(<ProductPicker products={PRODS} value={null} onPick={onPick} />);
  fireEvent.change(screen.getByLabelText("Buscar produto"), { target: { value: "mascara" } });
  expect(screen.queryByRole("option", { name: /Shampoo/ })).toBeNull();
  fireEvent.change(screen.getByLabelText("Buscar produto"), { target: { value: "7891234" } });
  fireEvent.click(screen.getByRole("option", { name: /Shampoo Hidratante/ }));
  expect(onPick).toHaveBeenCalledWith(PRODS[0]);
});
it("produto sem estoque: mostra o aviso e não trava nada", () => {
  const { rerender } = render(<ProductPicker products={PRODS} value={PRODS[1]} onPick={() => {}} />);
  expect(screen.getByText("Sem estoque: a venda fecha e o estoque fica negativo.")).toBeTruthy();
  expect(screen.getByText(/R\$\s*89 /)).toBeTruthy();
  rerender(<ProductPicker products={PRODS} value={PRODS[0]} onPick={() => {}} />);
  expect(screen.queryByText(/Sem estoque/)).toBeNull();
});
