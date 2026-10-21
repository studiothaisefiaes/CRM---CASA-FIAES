// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const a = vi.hoisted(() => ({
  salvarProduto: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { id: "n" } })),
  movimentarEstoque: vi.fn(async (..._a: unknown[]) => ({ ok: true as const })),
  movimentosDoProduto: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: [{ id: "m1", deltaQty: 5, reason: "entrada", note: null, unitCostCents: null, createdAt: new Date("2026-10-15T15:00:00Z"), cancelled: false }] })),
}));
vi.mock("@/app/(app)/servicos/actions", () => a);
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { ProductsTab } from "./products-tab";
import type { ProductRow } from "@/server/domain/estoque/produtos";

afterEach(() => { cleanup(); Object.values(a).forEach((f) => f.mockClear()); });

const row = (id: string, name: string, over: Partial<ProductRow> = {}): ProductRow => ({
  id, name, brand: null, category: null, barcode: null, ncm: null, cfop: "5102", csosn: "102", unit: "UN", priceCents: 5000, costCents: null, use: "venda", minQty: null,
  avecName: null, active: true, createdBy: null, createdAt: new Date(), updatedAt: new Date(), stockQty: 10, below: false, negative: false, ...over,
});
const ROWS = [
  row("p1", "Shampoo", { brand: "Kérastase", stockQty: 10 }),
  row("p2", "Máscara", { minQty: 5, stockQty: 2, below: true }),
  row("p3", "Óleo", { stockQty: -1, negative: true, below: true, minQty: 3 }),
];
const ALL = { produtos: true, movimentar: true };

it("as colunas são Produto, Marca, Preço, Estoque e Situação", () => {
  render(<ProductsTab rows={ROWS} can={ALL} />);
  const heads = within(screen.getByRole("table")).getAllByRole("columnheader").map((h) => h.textContent);
  expect(heads).toEqual(["Produto", "Marca", "Preço", "Estoque", "Situação"]);
});
it("o chip Abaixo do mínimo filtra a lista, e o estoque negativo tem rótulo próprio", () => {
  render(<ProductsTab rows={ROWS} can={ALL} />);
  expect(screen.getByText("Estoque negativo")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Abaixo do mínimo/ }));
  const t = within(screen.getByRole("table"));
  expect(t.queryByText("Shampoo")).toBeNull();
  expect(t.getByText("Máscara")).toBeTruthy();
  expect(t.getByText("Óleo")).toBeTruthy();
});
it("a busca acha por nome, marca ou código de barras", () => {
  render(<ProductsTab rows={[...ROWS, row("p4", "Gel", { barcode: "789000" })]} can={ALL} />);
  fireEvent.change(screen.getByRole("searchbox", { name: "Buscar produto" }), { target: { value: "789000" } });
  expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);
});
it("sem permissão nenhuma, não há Novo produto, Entrada, Saída nem Ajustar; a folha só mostra os dados", async () => {
  render(<ProductsTab rows={ROWS} can={{ produtos: false, movimentar: false }} />);
  expect(screen.queryByRole("button", { name: "Novo produto" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Shampoo/ }));
  const d = within(await screen.findByRole("dialog", { name: "Shampoo" }));
  for (const n of ["Entrada", "Saída", "Ajustar", "Salvar"]) expect(d.queryByRole("button", { name: n })).toBeNull();
  expect(d.queryByRole("textbox")).toBeNull();
  expect(d.getByText("5102")).toBeTruthy();
});
it("só movimentar: dá entrada mas não edita o produto; só produtos: edita mas não mexe no estoque", async () => {
  const { unmount } = render(<ProductsTab rows={ROWS} can={{ produtos: false, movimentar: true }} />);
  expect(screen.queryByRole("button", { name: "Novo produto" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Shampoo/ }));
  let d = within(await screen.findByRole("dialog", { name: "Shampoo" }));
  expect(d.getByRole("button", { name: "Entrada" })).toBeTruthy();
  expect(d.queryByLabelText("Nome")).toBeNull();
  unmount();
  render(<ProductsTab rows={ROWS} can={{ produtos: true, movimentar: false }} />);
  expect(screen.getByRole("button", { name: "Novo produto" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Shampoo/ }));
  d = within(await screen.findByRole("dialog", { name: "Shampoo" }));
  expect(d.getByLabelText("Nome")).toBeTruthy();
  expect(d.queryByRole("button", { name: "Entrada" })).toBeNull();
});
it("a folha tem Dados, Nota fiscal (CFOP e CSOSN editáveis com estoque.produtos) e Estoque com os últimos movimentos", async () => {
  render(<ProductsTab rows={ROWS} can={ALL} />);
  fireEvent.click(screen.getByRole("button", { name: /Shampoo/ }));
  const d = within(await screen.findByRole("dialog", { name: "Shampoo" }));
  for (const h of ["Dados", "Nota fiscal", "Estoque"]) expect(d.getByRole("heading", { name: h })).toBeTruthy();
  expect((d.getByLabelText("CFOP") as HTMLInputElement).value).toBe("5102");
  expect((d.getByLabelText("CSOSN") as HTMLInputElement).value).toBe("102");
  await waitFor(() => expect(d.getByText(/Entrada/, { selector: "li *, li" })).toBeTruthy());
  fireEvent.change(d.getByLabelText("Preço (R$)"), { target: { value: "55" } });
  fireEvent.click(d.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(a.salvarProduto).toHaveBeenCalledTimes(1));
  expect(a.salvarProduto.mock.calls[0][0]).toMatchObject({ id: "p1", name: "Shampoo", priceCents: 5500, cfop: "5102", csosn: "102" });
});
it("CFOP e CSOSN (M-3): mudar e salvar manda os códigos; produto novo nasce com o padrão de Configurações › Estoque", async () => {
  render(<ProductsTab rows={ROWS} can={ALL} padrao={{ cfop: "5405", csosn: "500" }} />);
  fireEvent.click(screen.getByRole("button", { name: /Shampoo/ }));
  let d = within(await screen.findByRole("dialog", { name: "Shampoo" }));
  fireEvent.change(d.getByLabelText("CFOP"), { target: { value: "54x05" } });
  fireEvent.change(d.getByLabelText("CSOSN"), { target: { value: "500" } });
  expect((d.getByLabelText("CFOP") as HTMLInputElement).value).toBe("5405"); // só números, até 4
  fireEvent.click(d.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(a.salvarProduto).toHaveBeenCalledTimes(1));
  expect(a.salvarProduto.mock.calls[0][0]).toMatchObject({ id: "p1", cfop: "5405", csosn: "500" });
  cleanup();
  render(<ProductsTab rows={ROWS} can={ALL} padrao={{ cfop: "5405", csosn: "500" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Novo produto" }));
  d = within(await screen.findByRole("dialog", { name: "Novo produto" }));
  expect((d.getByLabelText("CFOP") as HTMLInputElement).value).toBe("5405");
  expect((d.getByLabelText("CSOSN") as HTMLInputElement).value).toBe("500");
});
it("Entrada: pede a quantidade e manda ao servidor; Saída e Ajuste pedem o motivo", async () => {
  render(<ProductsTab rows={ROWS} can={ALL} />);
  fireEvent.click(screen.getByRole("button", { name: /Shampoo/ }));
  const d = within(await screen.findByRole("dialog", { name: "Shampoo" }));
  fireEvent.click(d.getByRole("button", { name: "Entrada" }));
  fireEvent.change(d.getByLabelText("Quantidade"), { target: { value: "3" } });
  fireEvent.click(d.getByRole("button", { name: "Registrar" }));
  await waitFor(() => expect(a.movimentarEstoque).toHaveBeenCalledWith({ productId: "p1", kind: "entrada", qty: 3, unitCostCents: null, note: null }));
  fireEvent.click(d.getByRole("button", { name: "Saída" }));
  fireEvent.change(d.getByLabelText("Quantidade"), { target: { value: "1" } });
  expect((d.getByRole("button", { name: "Registrar" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(d.getByLabelText("Motivo"), { target: { value: "quebrou" } });
  fireEvent.click(d.getByRole("button", { name: "Registrar" }));
  await waitFor(() => expect(a.movimentarEstoque).toHaveBeenLastCalledWith({ productId: "p1", kind: "saida", qty: 1, unitCostCents: null, note: "quebrou" }));
});
