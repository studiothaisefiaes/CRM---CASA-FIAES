// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const openWalkInAction = vi.fn();
vi.mock("@/app/(app)/caixa/actions", () => ({ openWalkInAction: (...a: unknown[]) => (openWalkInAction as (...x: unknown[]) => unknown)(...a), clientPackagesAction: vi.fn() }));
import { NewComanda } from "./new-comanda";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const catalog = { services: [{ id: "s1", label: "Corte" }], professionals: [{ id: "p1", name: "Maiara", active: true }], packageDefs: [], canGerir: false, today: "2026-10-15" };

it("Nova comanda (QA r58, I-8): não cria nada ao abrir; nasce quando o primeiro item é somado", async () => {
  openWalkInAction.mockResolvedValue({ ok: true, data: { comandaId: "c9", number: 9 } });
  const onCreated = vi.fn();
  render(<NewComanda catalog={catalog} onCreated={onCreated} onCancel={() => {}} />);
  expect(openWalkInAction).not.toHaveBeenCalled();
  expect(screen.getByText(/só passa a existir quando o primeiro item for somado/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Nome da cliente (opcional)"), { target: { value: "Moça do café" } });
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
  fireEvent.change(screen.getByLabelText("Serviço"), { target: { value: "s1" } });
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
