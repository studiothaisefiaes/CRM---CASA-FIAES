// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComandaDetail } from "@/server/queries/caixa";
import { money } from "@/lib/format";

const a = vi.hoisted(() => ({
  comandaDetailAction: vi.fn(), addItemAction: vi.fn(async () => ({ ok: true })), updateItemAction: vi.fn(async () => ({ ok: true })), removeItemAction: vi.fn(async () => ({ ok: true })),
  setDiscountAction: vi.fn(async () => ({ ok: true })), joinTodayAction: vi.fn(async () => ({ ok: true })), addPaymentAction: vi.fn(async () => ({ ok: true })),
  removePaymentAction: vi.fn(async () => ({ ok: true })), closeComandaAction: vi.fn(), discardComandaAction: vi.fn(async () => ({ ok: true })),
  cancelarComandaAction: vi.fn(async () => ({ ok: true })), undoCancelarComandaAction: vi.fn(async () => ({ ok: true })),
  cancelComandaAction: vi.fn(async () => ({ ok: true })), reopenComandaAction: vi.fn(async () => ({ ok: true })), openCashAction: vi.fn(async () => ({ ok: true })),
  clientPackagesAction: vi.fn(async () => ({ ok: true, data: [] })), setCpfAction: vi.fn(async () => ({ ok: true })),
}));
const toast = vi.fn();
vi.mock("@/app/(app)/caixa/actions", () => a);
vi.mock("@/components/ui/toast", () => ({ useToast: () => toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { ComandaSheet } from "./comanda-sheet";

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const CATALOG = { services: [{ id: "s1", label: "Corte" }], professionals: [{ id: "p1", name: "Ana", active: true }], packageDefs: [], canGerir: false, today: "2026-10-15", paymentOptions: [] };
const it0 = { originalUnitCents: 12000, priceReason: null, discountReason: null, fiscalKind: "servico", assistants: [], settlesComandaId: null };
const base: ComandaDetail = {
  id: "c1", number: 12, day: "2026-10-15", status: "aberta", contactId: "ct1", clientName: "Paula Souza", visitId: "v1", discountCents: 0, discountReason: null, cpf: null,
  items: [{ id: "i1", kind: "servico", label: "Corte", qty: 1, unitCents: 12000, discountCents: 0, totalCents: 12000, professionalId: "p1", professionalName: "Ana", appointmentId: "ap1", clientPackageId: null, commissionCents: null, ...it0 },
    { id: "i2", kind: "servico", label: "Mechas", qty: 1, unitCents: null, discountCents: 0, totalCents: null, professionalId: "p1", professionalName: "Ana", appointmentId: "ap2", clientPackageId: null, commissionCents: null, ...it0, originalUnitCents: null }],
  payments: [], totals: { subtotalCents: 12000, discountCents: 0, totalCents: 12000, missingPrice: ["Mechas"] }, paidCents: 0, remainingCents: 12000, changePreviewCents: 0, creditBalance: 0,
  closedByName: null, closedAt: null, changeCents: null, cancelReason: null, reopenReason: null, cashOpen: false, exigeCaixaAberto: false,
  feeCents: 0, netCents: 12000, missingFeeBrands: [], assistentes: { on: true, max: 2 }, debts: [], debtCents: 0, dividaOn: true, notaEscolha: { escolha: "sem_cpf", padrao: "sem_cpf", clientCpf: null, consentCpf: null },
};

it("mostra os itens; item sem preço pede o preço; Fechar comanda só quando tudo tem preço e o pagamento bate", async () => {
  a.comandaDetailAction.mockResolvedValue({ ok: true, data: base });
  render(<ComandaSheet comandaId="c1" open onClose={() => {}} catalog={CATALOG} />);
  expect(await screen.findByRole("dialog", { name: "Comanda 12 · Paula Souza" })).toBeTruthy();
  expect(screen.getByText("Falta o preço de Mechas.")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Fechar comanda" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Preço de Mechas (R$)"), { target: { value: "200" } });
  await act(async () => { fireEvent.blur(screen.getByLabelText("Preço de Mechas (R$)")); });
  expect(a.updateItemAction).toHaveBeenCalledWith("i2", { unitCents: 20000 });
});

it("receber sem caixa aberto (quando exigido): oferece 'Abrir caixa' e recebe de novo; o pagamento que completa o total fecha a comanda junto (psico r68 #4)", async () => {
  const pronta = { ...base, items: [base.items[0]], totals: { ...base.totals, missingPrice: [] } };
  a.comandaDetailAction.mockResolvedValue({ ok: true, data: pronta });
  a.addPaymentAction.mockResolvedValueOnce({ ok: false, error: "Abra o seu caixa para receber.", needsCash: true } as never).mockResolvedValueOnce({ ok: true });
  a.closeComandaAction.mockResolvedValueOnce({ ok: true, data: { number: 12, day: "2026-10-15", totalCents: 12000, changeCents: 0, creditCents: 0 } });
  render(<ComandaSheet comandaId="c1" open onClose={() => {}} catalog={CATALOG} />);
  const receber = await screen.findByRole("button", { name: "Receber e fechar" }); // o valor já é o total: um passo só
  await act(async () => { fireEvent.click(receber); });
  expect(screen.getByText("Abra o seu caixa para receber.")).toBeTruthy();
  expect(a.closeComandaAction).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Fundo de troco (R$)"), { target: { value: "100" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Abrir caixa e receber" })); });
  expect(a.openCashAction).toHaveBeenCalledWith({ openingCents: 10000 });
  expect(a.addPaymentAction).toHaveBeenCalledTimes(2);
  expect(a.addPaymentAction).toHaveBeenLastCalledWith("c1", { method: "pix", valueCents: 12000, installments: null, brand: null, customMethodId: null, note: null });
  expect(a.closeComandaAction).toHaveBeenLastCalledWith("c1", { saveChangeAsCredit: false });
  expect(toast).toHaveBeenLastCalledWith(`${money(12000)} no Pix · comanda 12 fechada`);
});

it("psico r68 #4: 'Fechar comanda' cinza diz por quê; pagamento parcial não fecha e diz quanto falta", async () => {
  const pronta = { ...base, items: [base.items[0]], totals: { ...base.totals, missingPrice: [] } };
  a.comandaDetailAction.mockResolvedValue({ ok: true, data: pronta });
  a.addPaymentAction.mockResolvedValueOnce({ ok: true });
  render(<ComandaSheet comandaId="c1" open onClose={() => {}} catalog={CATALOG} />);
  const fechar = await screen.findByRole("button", { name: "Fechar comanda" }) as HTMLButtonElement;
  expect(fechar.disabled).toBe(true);
  expect(document.getElementById(fechar.getAttribute("aria-describedby") ?? "")?.textContent).toBe(`Falta receber ${money(12000)}.`);
  fireEvent.change(screen.getByLabelText("Valor recebido (R$)"), { target: { value: "50" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Receber" })); });
  expect(a.closeComandaAction).not.toHaveBeenCalled();
  expect(toast).toHaveBeenLastCalledWith(`${money(5000)} no Pix · falta ${money(7000)}`);
});

it("ajustar o preço de um item pede motivo e manda a mudança", async () => {
  a.comandaDetailAction.mockResolvedValue({ ok: true, data: base });
  render(<ComandaSheet comandaId="c1" open onClose={() => {}} catalog={CATALOG} />);
  fireEvent.click(await screen.findByRole("button", { name: "Ajustar Corte" }));
  fireEvent.change(screen.getByLabelText("Preço de Corte (R$)"), { target: { value: "100" } });
  fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "cliente antiga" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar" })); });
  expect(a.updateItemAction).toHaveBeenCalledWith("i1", { unitCents: 10000, reason: "cliente antiga" });
});

it("fechada: Reabrir pede o motivo", async () => {
  a.comandaDetailAction.mockResolvedValue({ ok: true, data: { ...base, status: "fechada", closedByName: "Cati", closedAt: "2026-10-15T15:00:00.000Z" } });
  render(<ComandaSheet comandaId="c1" open onClose={() => {}} catalog={CATALOG} />);
  fireEvent.click(await screen.findByRole("button", { name: "Reabrir" }));
  fireEvent.change(screen.getByLabelText("Motivo da reabertura"), { target: { value: "esqueceu o shampoo" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Reabrir a comanda" })); });
  expect(a.reopenComandaAction).toHaveBeenCalledWith("c1", { reason: "esqueceu o shampoo" });
});

it("somar produto pelo formulário de item", async () => {
  a.comandaDetailAction.mockResolvedValue({ ok: true, data: base });
  render(<ComandaSheet comandaId="c1" open onClose={() => {}} catalog={CATALOG} />);
  await screen.findByRole("button", { name: "Somar item" });
  // O pagamento vem logo depois dos itens; somar item fica recolhido num botão.
  const order = [...document.querySelectorAll("section[aria-label]")].map((e) => e.getAttribute("aria-label"));
  expect(order.indexOf("Pagamento")).toBeLessThan(order.indexOf("Somar item") === -1 ? Infinity : order.indexOf("Somar item"));
  expect(screen.queryByRole("region", { name: "Somar item" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Somar item" }));
  fireEvent.click(screen.getByRole("radio", { name: "Produto" }));
  fireEvent.change(screen.getByLabelText("Produto"), { target: { value: "Shampoo" } });
  fireEvent.change(screen.getByLabelText("Preço (R$)"), { target: { value: "45,90" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Somar à comanda" })); });
  expect(a.addItemAction).toHaveBeenCalledWith("c1", { kind: "produto", label: "Shampoo", unitCents: 4590, qty: 1 });
});

it("desconto acima do limite (QA r58, I-11): pede a gestão ali mesmo, como no fechamento, e refaz com a aprovação", async () => {
  a.comandaDetailAction.mockResolvedValue({ ok: true, data: base });
  a.updateItemAction.mockResolvedValueOnce({ ok: false, error: "Desconto de 50% passa do limite de 20%: a gestão aprova.", needsApproval: true } as never).mockResolvedValueOnce({ ok: true });
  render(<ComandaSheet comandaId="c1" open onClose={() => {}} catalog={CATALOG} />);
  fireEvent.click(await screen.findByRole("button", { name: "Ajustar Corte" }));
  fireEvent.change(screen.getByLabelText("Preço de Corte (R$)"), { target: { value: "60" } });
  fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "amiga da dona" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar" })); });
  const box = screen.getByRole("region", { name: "Aprovação da gestão" });
  expect(box.textContent).toContain("Desconto de 50% passa do limite de 20%: a gestão aprova.");
  // Outra ação com a aprovação aberta (revisão): a aprovação antiga some, para o "Aprovar" nunca rodar a ação errada.
  a.joinTodayAction.mockResolvedValueOnce({ ok: false, error: "Nenhum outro horário de hoje para juntar." } as never);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Juntar horário de hoje" })); });
  expect(screen.queryByRole("region", { name: "Aprovação da gestão" })).toBeNull();
  a.updateItemAction.mockReset();
  a.updateItemAction.mockResolvedValueOnce({ ok: false, error: "Desconto de 50% passa do limite de 20%: a gestão aprova.", needsApproval: true } as never).mockResolvedValueOnce({ ok: true });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar" })); });
  fireEvent.change(screen.getByLabelText("E-mail da gestão"), { target: { value: "g@c.com" } });
  fireEvent.change(screen.getByLabelText("Senha da gestão"), { target: { value: "segredo" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Aprovar e salvar" })); });
  expect(a.updateItemAction).toHaveBeenLastCalledWith("i1", { unitCents: 6000, reason: "amiga da dona" }, { email: "g@c.com", password: "segredo" });
  expect(screen.queryByRole("region", { name: "Aprovação da gestão" })).toBeNull();
  cleanup();
  // A gestão aprova a própria com um clique.
  a.addPaymentAction.mockResolvedValueOnce({ ok: false, error: "Cortesia de 100% passa do limite de 20%: a gestão aprova.", needsApproval: true } as never).mockResolvedValueOnce({ ok: true });
  render(<ComandaSheet comandaId="c1" open onClose={() => {}} catalog={{ ...CATALOG, canGerir: true }} />);
  fireEvent.click(await screen.findByRole("radio", { name: "Cortesia" }));
  fireEvent.change(screen.getByLabelText("Motivo da cortesia"), { target: { value: "retoque" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Receber" })); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Aprovar" })); });
  expect(a.addPaymentAction).toHaveBeenLastCalledWith("c1", expect.objectContaining({ method: "cortesia", note: "retoque" }), { self: true });
});

it("item 20: o aviso da cliente salta ao abrir a comanda; naComanda desligado não salta", async () => {
  try { sessionStorage.clear(); } catch { /* sem armazenamento */ }
  a.comandaDetailAction.mockResolvedValue({ ok: true, data: { ...base, alertNotes: "Alérgica a amônia", imageUse: "nao" } });
  render(<ComandaSheet comandaId="c1" open onClose={() => {}} catalog={{ ...CATALOG, clientAlert: { on: true, text: "Sem foto, por favor" } }} />);
  const d = await screen.findByRole("dialog", { name: "Aviso da cliente" });
  expect(d.textContent).toContain("Alérgica a amônia");
  expect(d.textContent).toContain("Sem foto, por favor");
  cleanup();
  try { sessionStorage.clear(); } catch { /* sem armazenamento */ }
  render(<ComandaSheet comandaId="c1" open onClose={() => {}} catalog={{ ...CATALOG, clientAlert: { on: false, text: "x" } }} />);
  await screen.findByRole("dialog", { name: "Comanda 12 · Paula Souza" });
  expect(screen.queryByRole("dialog", { name: "Aviso da cliente" })).toBeNull();
});

it("dívida: marcar 'Deixar R$ 100 como dívida' libera o Fechar comanda e fecha com a dívida", async () => {
  const comFalta: ComandaDetail = { ...base, items: [base.items[0]], totals: { ...base.totals, missingPrice: [] }, paidCents: 2000, remainingCents: 10000,
    payments: [{ id: "pg", method: "pix", valueCents: 2000, installments: null, brand: null, note: null, customLabel: null, changeCents: 0, sessionOwnerName: "Cati", createdByName: "Cati", feeBp: null, feeCents: null }] };
  a.comandaDetailAction.mockResolvedValue({ ok: true, data: comFalta });
  a.closeComandaAction.mockResolvedValueOnce({ ok: true, data: { number: 12, day: "2026-10-15", totalCents: 12000, changeCents: 0, creditCents: 0, debtCents: 10000 } });
  render(<ComandaSheet comandaId="c1" open onClose={() => {}} catalog={{ ...CATALOG, canDivida: true }} />);
  const finalizar = await screen.findByRole("button", { name: "Fechar comanda" }) as HTMLButtonElement;
  expect(finalizar.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(`Deixar ${money(10000)} como dívida`.replace(/\s/g, " ")));
  expect(finalizar.disabled).toBe(false);
  await act(async () => { fireEvent.click(finalizar); });
  expect(a.closeComandaAction).toHaveBeenLastCalledWith("c1", { saveChangeAsCredit: false, leaveDebt: true });
  cleanup();
  // Sem a permissão (caixa.divida): nem aparece.
  render(<ComandaSheet comandaId="c1" open onClose={() => {}} catalog={CATALOG} />);
  await screen.findByRole("button", { name: "Fechar comanda" });
  expect(screen.queryByText(/como dívida/)).toBeNull();
});

it("dívida anterior: aparece com a comanda e o dia, e 'Cobrar junto' lança o item da dívida", async () => {
  const comDivida: ComandaDetail = { ...base, items: [base.items[0]], totals: { ...base.totals, missingPrice: [] }, debts: [{ comandaId: "c0", number: 1, day: "2026-10-15", remainingCents: 10000 }] };
  a.comandaDetailAction.mockResolvedValue({ ok: true, data: comDivida });
  render(<ComandaSheet comandaId="c1" open onClose={() => {}} catalog={CATALOG} />);
  expect(await screen.findByText(`Dívida anterior: ${money(10000)} (comanda 1 de 15/10)`, { normalizer: (t) => t })).toBeTruthy();
  // Pode cobrar só uma parte: o valor começa no que falta.
  expect((screen.getByLabelText("Quanto cobrar da comanda 1 (R$)") as HTMLInputElement).value).toBe("100,00");
  const lancada = { ...base.items[0], id: "i9", kind: "divida", label: "Dívida da comanda 1 de 15/10", professionalId: null, professionalName: null, appointmentId: null, originalUnitCents: null, unitCents: 10000, totalCents: 10000, settlesComandaId: "c0" };
  a.comandaDetailAction.mockResolvedValue({ ok: true, data: { ...comDivida, debts: [], items: [base.items[0], lancada] } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Cobrar junto" })); });
  expect(a.addItemAction).toHaveBeenCalledWith("c1", { kind: "divida", settlesComandaId: "c0", unitCents: 10000 });
  expect(await screen.findByText("Dívida da comanda 1 de 15/10")).toBeTruthy();
  // O item da dívida não tem profissional nem ajuste de valor (tira e lança de novo).
  expect(screen.queryByLabelText("Profissional de Dívida da comanda 1 de 15/10")).toBeNull();
  expect(screen.queryByRole("button", { name: "Ajustar Dívida da comanda 1 de 15/10" })).toBeNull();
  expect(screen.getByRole("button", { name: "Tirar Dívida da comanda 1 de 15/10" })).toBeTruthy();
  expect(screen.queryByText(/Dívida anterior/)).toBeNull();
});

it("r66 #4: ordem itens → Somar item/Desconto → Nota → Pagamento → Fechar comanda; nota sem escolha trava Receber e Fechar; 'Cancelar comanda' (nunca Descartar)", async () => {
  const pronta = { ...base, items: [base.items[0]], totals: { subtotalCents: 12000, discountCents: 0, totalCents: 12000, missingPrice: [] }, notaEscolha: { escolha: null, padrao: "perguntar" as const, clientCpf: null, consentCpf: null } } as unknown as ComandaDetail;
  a.comandaDetailAction.mockResolvedValue({ ok: true, data: pronta });
  render(<ComandaSheet comandaId="c1" open onClose={() => {}} catalog={CATALOG} />);
  await screen.findByRole("dialog", { name: "Comanda 12 · Paula Souza" });
  const antes = (x: Element, y: Element) => !!(x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING);
  const somar = screen.getByRole("button", { name: "Somar item" });
  const nota = screen.getByRole("region", { name: "Nota fiscal" });
  const pag = screen.getByRole("button", { name: "Receber" });
  expect(antes(somar, nota)).toBe(true);
  expect(antes(nota, pag)).toBe(true);
  expect((nota.querySelector("input:checked"))).toBeNull(); // nada marcado
  expect((pag as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Escolha a nota fiscal acima.")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Fechar comanda" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Descartar" })).toBeNull();
  // psico r68 #1: sem caixa.cancelar, nada de cancelar; e nunca um botão "Cancelar comanda" ao lado do Fechar
  expect(screen.queryByRole("button", { name: "Cancelar comanda" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Mais da comanda" })).toBeNull();
});

it("psico r68 #1: com caixa.cancelar, cancelar mora no '⋯' e abre a confirmação com motivo (nada é cancelado num clique)", async () => {
  a.comandaDetailAction.mockResolvedValue({ ok: true, data: base });
  render(<ComandaSheet comandaId="c1" open onClose={() => {}} catalog={{ ...CATALOG, canCancelar: true }} />);
  await screen.findByRole("dialog", { name: "Comanda 12 · Paula Souza" });
  fireEvent.click(screen.getByRole("button", { name: "Mais da comanda" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Cancelar comanda" }));
  expect(screen.getByRole("dialog", { name: /^Cancelar a comanda 12/ })).toBeTruthy();
  expect(a.discardComandaAction).not.toHaveBeenCalled();
});
