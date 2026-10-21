// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { money } from "@/lib/format";

const closeCashAction = vi.fn();
const toast = vi.fn();
vi.mock("@/app/(app)/caixa/actions", () => ({ closeCashAction: (...a: unknown[]) => (closeCashAction as (...x: unknown[]) => unknown)(...a) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { CashCloseSheet } from "./cash-close-sheet";

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
/** money() usa espaço fino; o normalizador padrão do Testing Library o troca por espaço comum. */
const raw = (t: string) => t;
const SUMMARY = { expected: { dinheiro: 17000, pix: 5000, credito: 0, debito: 0, outra: 0 }, byBrand: [], openComandas: 2 };
const qty = (label: string, n: string) => fireEvent.change(screen.getByLabelText(`Quantidade de ${label}`), { target: { value: n } });
const base = { open: true, onClose: () => {}, ownerName: "Cati", sessionId: null, hasOptions: false };

it("dinheiro pelas cédulas e moedas; Pix e cartão pelo total; o sistema ao lado e a diferença; avisa das comandas abertas", async () => {
  closeCashAction.mockResolvedValue({ ok: true, data: { status: "fechado", differenceCents: -500, expected: SUMMARY.expected, counted: {}, openComandas: 2, warning: "2 comandas abertas ficam para o próximo caixa." } });
  render(<CashCloseSheet {...base} summary={SUMMARY} blind={false} canGerir={false} />);
  expect(screen.getByText("2 comandas abertas ficam para o próximo caixa.")).toBeTruthy();
  qty("R$ 100", "1"); qty("R$ 50", "1"); qty("R$ 10", "1"); qty("R$ 5", "1");
  expect(screen.getByText(money(16500), { normalizer: raw, selector: "[data-testid='contado-dinheiro']" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Pix contado (R$)"), { target: { value: "50" } });
  expect(screen.getByText(`Diferença: ${money(-500)}`, { normalizer: raw })).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Fechar caixa" })); });
  expect(closeCashAction).toHaveBeenCalledWith({ sessionId: null, cashBreakdown: { "10000": 1, "5000": 1, "1000": 1, "500": 1 }, counted: { pix: 5000, credito: 0, debito: 0, outra: 0 }, notes: null, approval: null });
  expect(toast).toHaveBeenCalledWith(`Caixa fechado. Diferença: ${money(-500)}`, "info");
});

it("contagem cega: sem o sistema nem a diferença; depois de fechar, mostra o resultado", async () => {
  closeCashAction.mockResolvedValue({ ok: true, data: { status: "fechado", differenceCents: -500, expected: SUMMARY.expected, counted: { dinheiro: 16500 }, openComandas: 0, warning: null } });
  render(<CashCloseSheet {...base} summary={{ ...SUMMARY, expected: null }} blind canGerir={false} />);
  expect(screen.queryByText("Sistema")).toBeNull();
  expect(screen.getByText(/O valor esperado só aparece depois de fechar/)).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Fechar caixa" })); });
  expect(screen.getByText(`Esperado em dinheiro: ${money(17000)}`, { normalizer: raw })).toBeTruthy();
  expect(screen.getByText(`Diferença: ${money(-500)}`, { normalizer: raw })).toBeTruthy();
});

it("acima da tolerância: quem não é gestão chama a gestão (e-mail e senha); a gestão aprova a própria diferença", async () => {
  closeCashAction.mockResolvedValueOnce({ ok: true, data: { status: "precisa_aprovacao", differenceCents: null } })
    .mockResolvedValueOnce({ ok: true, data: { status: "fechado", differenceCents: -17000, expected: SUMMARY.expected, counted: {}, openComandas: 0, warning: null } });
  render(<CashCloseSheet {...base} summary={{ ...SUMMARY, expected: null }} blind canGerir={false} />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Fechar caixa" })); });
  expect(screen.getByText(/acima da tolerância/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("E-mail da gestão"), { target: { value: "g@c.com" } });
  fireEvent.change(screen.getByLabelText("Senha da gestão"), { target: { value: "segredo" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Aprovar e fechar" })); });
  expect(closeCashAction).toHaveBeenLastCalledWith(expect.objectContaining({ approval: { email: "g@c.com", password: "segredo" } }));
  cleanup();
  closeCashAction.mockResolvedValueOnce({ ok: true, data: { status: "precisa_aprovacao", differenceCents: -17000 } }).mockResolvedValueOnce({ ok: true, data: { status: "fechado", differenceCents: -17000, expected: SUMMARY.expected, counted: {}, openComandas: 0, warning: null } });
  render(<CashCloseSheet {...base} summary={SUMMARY} blind={false} canGerir />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Fechar caixa" })); });
  expect(screen.getByText(`Diferença de ${money(-17000)} acima da tolerância.`, { normalizer: raw })).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Aprovar a diferença" })); });
  expect(closeCashAction).toHaveBeenLastCalledWith(expect.objectContaining({ approval: { self: true } }));
});

it("forma por forma (QA r58, C-1): falta no dinheiro e sobra no Pix aparecem separadas no pedido, no aviso e no resultado da contagem cega", async () => {
  const differences = { dinheiro: -10000, pix: 10000, credito: 0, debito: 0, outra: 0 };
  const expected = { dinheiro: 24000, pix: 9000, credito: 0, debito: 3000, outra: 0 };
  const counted = { dinheiro: 14000, pix: 19000, credito: 0, debito: 3000, outra: 0 };
  const forms = `Dinheiro ${money(-10000)} · Pix ${money(10000)}`;
  closeCashAction.mockResolvedValueOnce({ ok: true, data: { status: "precisa_aprovacao", differenceCents: 0, differences } })
    .mockResolvedValueOnce({ ok: true, data: { status: "fechado", differenceCents: 0, differences, expected, counted, openComandas: 0, warning: null } });
  render(<CashCloseSheet {...base} summary={{ ...SUMMARY, expected }} blind={false} canGerir />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Fechar caixa" })); });
  expect(screen.getByText(`Diferenças acima da tolerância: ${forms}.`, { normalizer: raw })).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Aprovar a diferença" })); });
  expect(toast).toHaveBeenLastCalledWith(`Caixa fechado. Diferenças: ${forms}`, "info");
  cleanup();
  closeCashAction.mockResolvedValueOnce({ ok: true, data: { status: "fechado", differenceCents: 0, differences, expected, counted, openComandas: 0, warning: null } });
  render(<CashCloseSheet {...base} summary={{ ...SUMMARY, expected: null }} blind canGerir={false} />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Fechar caixa" })); });
  expect(screen.getByText(`Dinheiro: esperado ${money(24000)}, contado ${money(14000)}, diferença ${money(-10000)}`, { normalizer: raw })).toBeTruthy();
  expect(screen.getByText(`Pix: esperado ${money(9000)}, contado ${money(19000)}, diferença ${money(10000)}`, { normalizer: raw })).toBeTruthy();
});
