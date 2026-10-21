// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComandaDetail } from "@/server/queries/caixa";
import { money } from "@/lib/format";
import { PaymentPanel } from "./payment-panel";

afterEach(cleanup);
export const detail = (over: Partial<ComandaDetail> = {}): ComandaDetail => ({
  id: "c1", number: 1, day: "2026-10-15", status: "aberta", contactId: "p1", clientName: "Paula Souza", visitId: null, discountCents: 0, discountReason: null, cpf: null, items: [], payments: [],
  totals: { subtotalCents: 12000, discountCents: 0, totalCents: 12000, missingPrice: [] }, paidCents: 0, remainingCents: 12000, changePreviewCents: 0, creditBalance: 0,
  closedByName: null, closedAt: null, changeCents: null, cancelReason: null, reopenReason: null, cashOpen: false, exigeCaixaAberto: false,
  feeCents: 0, netCents: 12000, missingFeeBrands: [], assistentes: { on: true, max: 2 }, debts: [], debtCents: 0, dividaOn: true, notaEscolha: { escolha: "sem_cpf", padrao: "sem_cpf", clientCpf: null, consentCpf: null }, ...over,
});
const pay = (over: Partial<ComandaDetail["payments"][number]>): ComandaDetail["payments"][number] => ({
  id: "x", method: "pix", valueCents: 0, installments: null, brand: null, note: null, customLabel: null, changeCents: 0, sessionOwnerName: "Cati", createdByName: "Cati", feeBp: null, feeCents: null, ...over,
});
const props = { pending: false, saveChange: false, onSaveChange: () => {}, onRemove: () => {}, paymentOptions: [{ id: "o1", label: "Transferência" }] };
const valor = () => screen.getByLabelText("Valor recebido (R$)") as HTMLInputElement;
const receber = () => screen.getByRole("button", { name: "Receber" }) as HTMLButtonElement;

it("crédito: bandeira obrigatória e parcelas de 1x a 12x; o valor começa no restante", () => {
  const onAdd = vi.fn();
  render(<PaymentPanel detail={detail()} onAdd={onAdd} {...props} />);
  expect(valor().value).toBe("120,00");
  expect(screen.getByText("Restante a pagar")).toBeTruthy();
  expect(screen.queryByRole("radio", { name: "Crédito da cliente" })).toBeNull(); // sem saldo
  fireEvent.click(screen.getByRole("radio", { name: "Crédito" }));
  expect(receber().disabled).toBe(true);
  expect(screen.getByText("Escolha a bandeira.")).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: "Mastercard" }));
  fireEvent.change(screen.getByLabelText("Parcelas"), { target: { value: "3" } });
  fireEvent.change(valor(), { target: { value: "50" } });
  fireEvent.change(screen.getByLabelText("Observação"), { target: { value: "maquininha 2" } });
  fireEvent.click(receber());
  expect(onAdd).toHaveBeenCalledWith({ method: "credito", valueCents: 5000, installments: 3, brand: "mastercard", customMethodId: null, note: "maquininha 2" });
});

it("troco ao vivo só sobre o dinheiro (regra do Norte)", () => {
  render(<PaymentPanel detail={detail({ payments: [pay({ method: "pix", valueCents: 5000 })], paidCents: 5000, remainingCents: 7000 })} onAdd={() => {}} {...props} />);
  fireEvent.click(screen.getByRole("radio", { name: "Dinheiro" }));
  fireEvent.change(valor(), { target: { value: "100" } });
  expect(screen.getByText(`Troco: ${money(3000)}`, { normalizer: (t) => t })).toBeTruthy();
});

it("cortesia pede o motivo; Outra forma pede qual", () => {
  const onAdd = vi.fn();
  render(<PaymentPanel detail={detail()} onAdd={onAdd} {...props} />);
  fireEvent.click(screen.getByRole("radio", { name: "Cortesia" }));
  expect(receber().disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Motivo da cortesia"), { target: { value: "aniversário" } });
  expect(receber().disabled).toBe(false);
  fireEvent.click(screen.getByRole("radio", { name: "Outra forma" }));
  expect(receber().disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Qual forma"), { target: { value: "o1" } });
  fireEvent.click(receber());
  expect(onAdd).toHaveBeenCalledWith({ method: "outra", valueCents: 12000, installments: null, brand: null, customMethodId: "o1", note: null });
});

it("troco já recebido aparece e, com cliente, oferece guardar como crédito; o pagamento mostra bandeira, parcelas e quem recebeu", () => {
  const onSaveChange = vi.fn();
  render(<PaymentPanel detail={detail({ payments: [pay({ method: "credito", valueCents: 3000, brand: "visa", installments: 2 }), pay({ id: "y", method: "dinheiro", valueCents: 12000 })], paidCents: 15000, remainingCents: 0, changePreviewCents: 3000, creditBalance: 2000 })}
    onAdd={() => {}} {...props} onSaveChange={onSaveChange} />);
  expect(screen.getByText(`Troco: ${money(3000)}`, { normalizer: (t) => t })).toBeTruthy();
  expect(screen.getByText("Crédito · Visa · 2x")).toBeTruthy();
  expect(screen.getAllByText("Caixa de Cati")).toHaveLength(2);
  fireEvent.click(screen.getByLabelText("Guardar o troco como crédito da cliente"));
  expect(onSaveChange).toHaveBeenCalledWith(true);
});

it("estornar pede confirmação com motivo opcional", () => {
  const onRemove = vi.fn();
  render(<PaymentPanel detail={detail({ payments: [pay({ valueCents: 5000 })], paidCents: 5000, remainingCents: 7000 })} onAdd={() => {}} {...props} onRemove={onRemove} />);
  fireEvent.click(screen.getByRole("button", { name: "Estornar" }));
  fireEvent.change(screen.getByLabelText("Motivo do estorno (opcional)"), { target: { value: "pix não caiu" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirmar estorno" }));
  expect(onRemove).toHaveBeenCalledWith("x", "pix não caiu");
});

it("Receber cinza diz o que falta (QA r58, I-7): o motivo da cortesia e o valor aparecem, ligados ao botão", () => {
  render(<PaymentPanel detail={detail()} onAdd={() => {}} {...props} />);
  const why = () => document.getElementById(receber().getAttribute("aria-describedby") ?? "")?.textContent ?? null;
  fireEvent.click(screen.getByRole("radio", { name: "Cortesia" }));
  expect(receber().disabled).toBe(true);
  expect(why()).toBe("Escreva o motivo da cortesia.");
  expect((screen.getByLabelText("Motivo da cortesia") as HTMLInputElement).getAttribute("aria-required")).toBe("true");
  fireEvent.change(screen.getByLabelText("Motivo da cortesia"), { target: { value: "aniversário" } });
  fireEvent.change(valor(), { target: { value: "" } });
  expect(why()).toBe("Digite o valor.");
  fireEvent.change(valor(), { target: { value: "120" } });
  expect(receber().disabled).toBe(false);
  expect(receber().getAttribute("aria-describedby")).toBeNull();
});

it("taxa do cartão: aparece na linha do pagamento e no rodapé com o líquido; bandeira sem taxa avisa", () => {
  render(<PaymentPanel detail={detail({ payments: [pay({ method: "credito", brand: "visa", valueCents: 10000, feeBp: 243, feeCents: 243 })], paidCents: 10000, remainingCents: 2000, feeCents: 243, netCents: 11757, missingFeeBrands: ["Alelo"] })} onAdd={() => {}} {...props} />);
  expect(screen.getByText(/^taxa R\$\s2,43$/)).toBeTruthy();
  expect(screen.getByText("Taxas do cartão")).toBeTruthy();
  expect(screen.getAllByText(/^R\$\s2,43$/)).toBeTruthy();
  expect(screen.getByText("Líquido")).toBeTruthy();
  expect(screen.getByText(/^R\$\s117,57$/)).toBeTruthy();
  expect(screen.getByText("Sem taxa cadastrada: Alelo")).toBeTruthy();
});

it("sem taxa (recurso desligado ou só pix): nada de taxa nem líquido na tela", () => {
  render(<PaymentPanel detail={detail({ payments: [pay({ method: "pix", valueCents: 5000 })], paidCents: 5000, remainingCents: 7000 })} onAdd={() => {}} {...props} />);
  expect(screen.queryByText("Taxas do cartão")).toBeNull();
  expect(screen.queryByText("Líquido")).toBeNull();
  expect(screen.queryByText(/Sem taxa cadastrada/)).toBeNull();
});

const corte = { id: "i1", kind: "servico", label: "Corte", qty: 1, unitCents: 12000, discountCents: 0, totalCents: 12000, professionalId: "p1", professionalName: "Ana", appointmentId: null,
  clientPackageId: null, commissionCents: null, originalUnitCents: 12000, priceReason: null, discountReason: null, fiscalKind: "servico", assistants: [], settlesComandaId: null };
const comFalta = detail({ items: [corte], payments: [pay({ valueCents: 2000 })], paidCents: 2000, remainingCents: 10000 });

it("dívida: com falta, cliente escolhida e itens com preço, oferece deixar o que falta como dívida", () => {
  const onLeaveDebt = vi.fn();
  render(<PaymentPanel detail={comFalta} onAdd={() => {}} {...props} canLeaveDebt leaveDebt={false} onLeaveDebt={onLeaveDebt} />);
  fireEvent.click(screen.getByLabelText(`Deixar ${money(10000)} como dívida`.replace(/\s/g, " ")));
  expect(onLeaveDebt).toHaveBeenCalledWith(true);
});

it("dívida: não oferece sem cliente, sem item, com item sem preço, sem a permissão ou com o recurso desligado", () => {
  const off = (d: ComandaDetail, can = true) => {
    render(<PaymentPanel detail={d} onAdd={() => {}} {...props} canLeaveDebt={can} leaveDebt={false} onLeaveDebt={() => {}} />);
    const r = screen.queryByText(/como dívida/);
    cleanup();
    return r;
  };
  expect(off({ ...comFalta, contactId: null })).toBeNull();
  expect(off({ ...comFalta, items: [] })).toBeNull();
  expect(off({ ...comFalta, totals: { ...comFalta.totals, missingPrice: ["Mechas"] } })).toBeNull();
  expect(off({ ...comFalta, dividaOn: false })).toBeNull();
  expect(off(comFalta, false)).toBeNull();
  expect(off({ ...comFalta, remainingCents: 0 })).toBeNull();
  // Comanda que quita dívida não deixa dívida nova (não rola a dívida).
  expect(off({ ...comFalta, items: [corte, { ...corte, id: "i2", kind: "divida", label: "Dívida da comanda 1 de 15/10", professionalId: null, professionalName: null, settlesComandaId: "c0" }] })).toBeNull();
});
