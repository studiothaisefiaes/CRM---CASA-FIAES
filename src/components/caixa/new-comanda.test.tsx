// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const openWalkInAction = vi.fn();
vi.mock("@/app/(app)/caixa/actions", () => ({ openWalkInAction: (...a: unknown[]) => (openWalkInAction as (...x: unknown[]) => unknown)(...a), clientPackagesAction: vi.fn(async () => ({ ok: true, data: [] })) }));
vi.mock("@/app/(app)/agenda/actions", () => ({
  searchClientsAction: vi.fn(async () => ({ ok: true, data: [{ id: "ct1", name: "Paula Souza", phone: "+5571988000101", lastVisit: null, ignored: false }] })),
  peopleOnNumberAction: vi.fn(async () => ({ ok: true, data: [] })),
}));
import { NewComanda } from "./new-comanda";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const catalog = { services: [{ id: "s1", label: "Corte" }], professionals: [{ id: "p1", name: "Maiara", active: true }], packageDefs: [], canGerir: false, today: "2026-10-15" };

it("Nova comanda (QA r58, I-8): não cria nada ao abrir; nasce quando o primeiro item é somado", async () => {
  openWalkInAction.mockResolvedValue({ ok: true, data: { comandaId: "c9", number: 9 } });
  const onCreated = vi.fn();
  render(<NewComanda catalog={catalog} onCreated={onCreated} onCancel={() => {}} />);
  expect(openWalkInAction).not.toHaveBeenCalled();
  expect(screen.getByText(/só passa a existir quando o primeiro item for somado/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Ou só o nome (cliente de balcão)"), { target: { value: "Moça do café" } });
  fireEvent.click(screen.getByRole("radio", { name: "Produto" }));
  fireEvent.change(screen.getByLabelText("Produto"), { target: { value: "Kit" } });
  fireEvent.change(screen.getByLabelText("Preço (R$)"), { target: { value: "50" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Somar à comanda" })); });
  expect(openWalkInAction).toHaveBeenCalledWith({ requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/), clientName: "Moça do café", item: { kind: "produto", label: "Kit", unitCents: 5000, qty: 1 } });
  expect(onCreated).toHaveBeenCalledWith("c9");
});

it("o servidor recusa o item: o erro aparece e nada é criado", async () => {
  openWalkInAction.mockResolvedValue({ ok: false, error: "Escolha a profissional de Corte." });
  const onCreated = vi.fn();
  render(<NewComanda catalog={catalog} onCreated={onCreated} onCancel={() => {}} />);
  fireEvent.change(screen.getByRole("combobox", { name: "Serviço" }), { target: { value: "cor" } });
  fireEvent.click(screen.getByRole("option", { name: /Corte/ }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Somar à comanda" })); });
  expect(screen.getByRole("alert").textContent).toBe("Escolha a profissional de Corte.");
  expect(onCreated).not.toHaveBeenCalled();
});

it("preço abaixo do limite de desconto (QA r58, I-11): a gestão aprova ali e a comanda nasce", async () => {
  openWalkInAction.mockResolvedValueOnce({ ok: false, error: "Desconto de 50% passa do limite de 20%: a gestão aprova.", needsApproval: true })
    .mockResolvedValueOnce({ ok: true, data: { comandaId: "c9", number: 9 } });
  const onCreated = vi.fn();
  render(<NewComanda catalog={{ ...catalog, canGerir: true }} onCreated={onCreated} onCancel={() => {}} />);
  fireEvent.click(screen.getByRole("radio", { name: "Produto" }));
  fireEvent.change(screen.getByLabelText("Produto"), { target: { value: "Kit" } });
  fireEvent.change(screen.getByLabelText("Preço (R$)"), { target: { value: "50" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Somar à comanda" })); });
  expect(screen.getByRole("region", { name: "Aprovação da gestão" }).textContent).toContain("passa do limite de 20%");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Aprovar" })); });
  expect(openWalkInAction).toHaveBeenLastCalledWith(expect.objectContaining({ approval: { self: true } }));
  expect(onCreated).toHaveBeenCalledWith("c9");
});

it("serviço com preço digitado (revisão): o 'Motivo do preço' mostra 'obrigatório'", () => {
  render(<NewComanda catalog={catalog} onCreated={() => {}} onCancel={() => {}} />);
  fireEvent.change(screen.getByLabelText("Preço (R$)"), { target: { value: "50" } });
  expect((screen.getByLabelText("Motivo do preço") as HTMLInputElement).getAttribute("aria-required")).toBe("true");
  expect(screen.getByText("obrigatório")).toBeTruthy();
});

it("22/10: escolhe a cliente na busca e a profissional no topo; o item já vem com ela e a comanda nasce ligada à ficha", async () => {
  openWalkInAction.mockResolvedValue({ ok: true, data: { comandaId: "c9", number: 9 } });
  render(<NewComanda catalog={catalog} onCreated={() => {}} onCancel={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText(/nome ou telefone/i), { target: { value: "Paula" } });
  await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
  const paula = await screen.findByRole("button", { name: /Paula Souza/ });
  await act(async () => { fireEvent.click(paula); });
  expect(screen.getByTestId("cliente-escolhida").textContent).toBe("Paula Souza");
  expect(screen.queryByLabelText("Ou só o nome (cliente de balcão)")).toBeNull();
  fireEvent.change(screen.getByLabelText("Profissional da comanda"), { target: { value: "p1" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Serviço" }), { target: { value: "cor" } });
  fireEvent.click(screen.getByRole("option", { name: /Corte/ }));
  expect((screen.getByLabelText("Profissional") as HTMLSelectElement).value).toBe("p1");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Somar à comanda" })); });
  expect(openWalkInAction).toHaveBeenCalledWith({ requestKey: expect.any(String), client: { contactId: "ct1" }, item: { kind: "servico", serviceId: "s1", professionalId: "p1", qty: 1 } });
});
