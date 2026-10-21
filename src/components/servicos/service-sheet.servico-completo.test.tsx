// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { update, create, terms } = vi.hoisted(() => ({
  update: vi.fn(async (..._a: unknown[]) => ({ ok: true as const })),
  create: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { id: "99999999-9999-4999-8999-999999999999" } })),
  terms: vi.fn(async (..._a: unknown[]) => ({ ok: true as const })),
}));
vi.mock("@/app/(app)/servicos/actions", () => ({
  updateServiceAction: (...a: unknown[]) => update(...a), createServiceAction: (...a: unknown[]) => create(...a), setProServiceTermsAction: (...a: unknown[]) => terms(...a),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { ServiceSheet, type ServiceSheetOpts } from "./service-sheet";
import type { ServicePro, ServiceRow } from "@/server/domain/services";

afterEach(() => { cleanup(); update.mockClear(); create.mockClear(); terms.mockClear(); });

const ANA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", BIA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROS: ServicePro[] = [{ id: ANA, name: "ANA PAULA", color: null, photoUrl: null }, { id: BIA, name: "Bia", color: null, photoUrl: null }];
const ID = "22222222-2222-4222-8222-222222222222";
const CORTE: ServiceRow = {
  id: ID, label: "Corte Feminino", category: null, priceCents: 12_000, durationMin: 60, bufferMin: 10, cycleDays: null, description: null, active: true,
  professionalIds: [ANA, BIA], aiProIds: [], aiProScope: null, aiCitavel: true, priceKind: null, parallelOk: null, proTerms: { [BIA]: { priceCents: 15_000, durationMin: null } }, costCents: 3_000, fiscalCtribNac: null, fiscalNbs: null,
};
const ALL: ServiceSheetOpts = { canCost: true, canProTerms: true, precoPorPro: true, juntoComOutro: true };
const open = (service: ServiceRow | null, opts: ServiceSheetOpts = ALL) =>
  render(<ServiceSheet open service={service} professionals={PROS} categories={[]} canEdit opts={opts} onClose={() => {}} />);

it("ficha do serviço: custo, como o preço aparece, junto com outro, folga depois e preço e tempo de cada profissional", async () => {
  open(CORTE);
  const d = within(screen.getByRole("dialog", { name: "Corte Feminino" }));
  expect((d.getByLabelText("Custo (R$)") as HTMLInputElement).value).toBe("30,00");
  expect((d.getByLabelText("Folga depois (min)") as HTMLInputElement).value).toBe("10");
  const preco = d.getByLabelText("Preço") as HTMLSelectElement;
  expect([...preco.options].map((o) => o.text)).toEqual(["Fixo", "A partir de", "Sob consulta"]);
  const junto = d.getByLabelText("Pode ser feito junto com outro") as HTMLSelectElement;
  expect([...junto.options].map((o) => o.text)).toEqual(["Não informado", "Sim", "Não"]);
  expect((d.getByLabelText("Preço próprio de Bia") as HTMLInputElement).value).toBe("150,00");
  expect((d.getByLabelText("Tempo próprio de Bia") as HTMLInputElement).value).toBe("");
  fireEvent.change(preco, { target: { value: "a_partir_de" } });
  fireEvent.change(junto, { target: { value: "sim" } });
  fireEvent.change(d.getByLabelText("Custo (R$)"), { target: { value: "40,00" } });
  fireEvent.change(d.getByLabelText("Preço próprio de Ana Paula"), { target: { value: "300,00" } });
  fireEvent.change(d.getByLabelText("Tempo próprio de Ana Paula"), { target: { value: "150" } });
  fireEvent.click(d.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(terms).toHaveBeenCalledTimes(1));
  expect(update).toHaveBeenCalledWith(ID, { priceKind: "a_partir_de", parallelOk: true, costCents: 4000 });
  expect(terms).toHaveBeenCalledWith(ANA, ID, { priceCents: 30000, durationMin: 150 });
});

it("apagar o preço próprio volta ao do serviço (null); 'Fixo' e 'Não informado' gravam vazio", async () => {
  open({ ...CORTE, priceKind: "sob_consulta", parallelOk: false });
  const d = within(screen.getByRole("dialog", { name: "Corte Feminino" }));
  fireEvent.change(d.getByLabelText("Preço próprio de Bia"), { target: { value: "" } });
  fireEvent.change(d.getByLabelText("Preço"), { target: { value: "fixo" } });
  fireEvent.change(d.getByLabelText("Pode ser feito junto com outro"), { target: { value: "" } });
  fireEvent.click(d.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(terms).toHaveBeenCalledTimes(1));
  expect(update).toHaveBeenCalledWith(ID, { priceKind: null, parallelOk: null });
  expect(terms).toHaveBeenCalledWith(BIA, ID, { priceCents: null, durationMin: null });
});

it("sem servicos.custo o custo não aparece nem vai no pedido; funções desligadas escondem os campos delas", async () => {
  const { costCents: _sem, ...semCusto } = CORTE;
  void _sem;
  open(semCusto, { canCost: false, canProTerms: true, precoPorPro: false, juntoComOutro: false });
  const d = within(screen.getByRole("dialog", { name: "Corte Feminino" }));
  expect(d.queryByLabelText("Custo (R$)")).toBeNull();
  expect(d.queryByLabelText("Pode ser feito junto com outro")).toBeNull();
  expect(d.queryByLabelText(/Preço próprio de/)).toBeNull();
  expect(d.getByLabelText("Preço")).toBeTruthy(); // segue servicos.editar
  fireEvent.change(d.getByLabelText("Duração (min)"), { target: { value: "90" } });
  fireEvent.click(d.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(update).toHaveBeenCalledWith(ID, { durationMin: 90 }));
  expect(terms).not.toHaveBeenCalled();
});

it("sem servicos.por_profissional não há preço e tempo próprios (a função ligada não basta)", () => {
  open(CORTE, { ...ALL, canProTerms: false });
  expect(within(screen.getByRole("dialog", { name: "Corte Feminino" })).queryByLabelText(/Tempo próprio de/)).toBeNull();
});

it("tempo próprio inválido não salva nada", async () => {
  open(CORTE);
  const d = within(screen.getByRole("dialog", { name: "Corte Feminino" }));
  fireEvent.change(d.getByLabelText("Tempo próprio de Ana Paula"), { target: { value: "2" } });
  fireEvent.click(d.getByRole("button", { name: "Salvar" }));
  expect(await d.findByRole("alert")).toHaveProperty("textContent", "Tempo próprio de Ana Paula: de 5 a 720 minutos.");
  expect(update).not.toHaveBeenCalled();
  expect(terms).not.toHaveBeenCalled();
});

it("serviço novo: cria com custo e tipo de preço e depois grava o preço e o tempo de quem faz", async () => {
  open(null);
  const d = within(screen.getByRole("dialog", { name: "Novo serviço" }));
  fireEvent.change(d.getByLabelText("Nome"), { target: { value: "Luzes" } });
  fireEvent.change(d.getByLabelText("Preço (R$)"), { target: { value: "500,00" } });
  fireEvent.change(d.getByLabelText("Preço"), { target: { value: "a_partir_de" } });
  fireEvent.change(d.getByLabelText("Custo (R$)"), { target: { value: "100,00" } });
  fireEvent.click(within(d.getByRole("group", { name: /^Quem faz/ })).getByRole("checkbox", { name: /Ana Paula/ }));
  fireEvent.change(d.getByLabelText("Tempo próprio de Ana Paula"), { target: { value: "180" } });
  fireEvent.click(d.getByRole("button", { name: "Criar serviço" }));
  await waitFor(() => expect(terms).toHaveBeenCalledTimes(1));
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ label: "Luzes", priceCents: 50000, priceKind: "a_partir_de", costCents: 10000, professionalIds: [ANA] }));
  expect(create.mock.calls[0][0]).not.toHaveProperty("parallelOk");
  expect(terms).toHaveBeenCalledWith(ANA, "99999999-9999-4999-8999-999999999999", { priceCents: null, durationMin: 180 });
});
