// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/app/(app)/caixa/actions", () => ({ clientPackagesAction: vi.fn(async () => ({ ok: true, data: [] })) }));
vi.mock("@/app/(app)/agenda/actions", () => ({ searchClientsAction: vi.fn(), peopleOnNumberAction: vi.fn() }));
import { AddItem, type ComandaCatalog } from "./comanda-panel";

afterEach(cleanup);
const base: ComandaCatalog = {
  services: [], professionals: [{ id: "pr1", name: "Ana", active: true }], packageDefs: [], canGerir: false,
  products: [{ id: "p1", name: "Shampoo Hidratante", priceCents: 5000, barcode: "789", stockQty: 0 }], estoqueLigado: true,
};
const comanda = { contactId: "c1", day: "2026-10-18" };

it("com o estoque ligado, Produto é busca no catálogo; o preço vem do catálogo e o botão fica habilitado mesmo sem estoque", () => {
  const onAdd = vi.fn();
  render(<AddItem comanda={comanda} catalog={base} pending={false} onAdd={onAdd} />);
  fireEvent.click(screen.getByRole("radio", { name: "Produto" }));
  expect(screen.getByLabelText("Buscar produto")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Buscar produto"), { target: { value: "shamp" } });
  fireEvent.click(screen.getByRole("option", { name: /Shampoo Hidratante/ }));
  expect(screen.getByText("Sem estoque: a venda fecha e o estoque fica negativo.")).toBeTruthy();
  const btn = screen.getByRole("button", { name: "Somar à comanda" }) as HTMLButtonElement;
  expect(btn.disabled).toBe(false);
  fireEvent.click(btn);
  expect(onAdd).toHaveBeenCalledWith({ kind: "produto", productId: "p1", qty: 1 });
});
it("sem escolher o produto, Somar fica desligado", () => {
  render(<AddItem comanda={comanda} catalog={base} pending={false} onAdd={() => {}} />);
  fireEvent.click(screen.getByRole("radio", { name: "Produto" }));
  expect((screen.getByRole("button", { name: "Somar à comanda" }) as HTMLButtonElement).disabled).toBe(true);
});
it("preço diferente do catálogo pede o motivo", () => {
  const onAdd = vi.fn();
  render(<AddItem comanda={comanda} catalog={base} pending={false} onAdd={onAdd} />);
  fireEvent.click(screen.getByRole("radio", { name: "Produto" }));
  fireEvent.click(screen.getByRole("option", { name: /Shampoo Hidratante/ }));
  fireEvent.change(screen.getByLabelText("Preço (R$)"), { target: { value: "40" } });
  expect(screen.getByLabelText("Motivo do preço")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Motivo do preço"), { target: { value: "promoção" } });
  fireEvent.click(screen.getByRole("button", { name: "Somar à comanda" }));
  expect(onAdd).toHaveBeenCalledWith({ kind: "produto", productId: "p1", qty: 1, unitCents: 4000, reason: "promoção" });
});
it("com o estoque desligado, Produto volta ao texto livre de hoje", () => {
  const onAdd = vi.fn();
  render(<AddItem comanda={comanda} catalog={{ ...base, estoqueLigado: false, products: [] }} pending={false} onAdd={onAdd} />);
  fireEvent.click(screen.getByRole("radio", { name: "Produto" }));
  expect(screen.queryByLabelText("Buscar produto")).toBeNull();
  fireEvent.change(screen.getByLabelText("Produto"), { target: { value: "Pente" } });
  fireEvent.click(screen.getByRole("button", { name: "Somar à comanda" }));
  expect(onAdd).toHaveBeenCalledWith({ kind: "produto", label: "Pente", unitCents: null, qty: 1 });
});
