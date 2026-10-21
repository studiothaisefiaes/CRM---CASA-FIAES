// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/app/(app)/caixa/actions", () => ({ closeCashAction: vi.fn(), openCashAction: vi.fn(), movementAction: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { CashClosed, CashHeader } from "./cash-header";

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(cleanup);
const mine = { sessionId: "s1", openedAt: "2026-10-15T12:00:00.000Z", blind: true, openComandas: 0, expected: null, byBrand: [] };

it("um só botão para fechar: 'Fechar caixa / dia' leva ao assistente; sem caixa aberto, o cabeçalho fica vazio (o convite está no corpo)", () => {
  const { rerender, container } = render(<CashHeader name="Ana" mine={mine} />);
  expect(screen.getByRole("link", { name: "Fechar caixa / dia" }).getAttribute("href")).toBe("/caixa/fechar-dia");
  // psico r68 #5: fechar é secundário (contorno); o preto do Caixa é a ação do dia (Receber na comanda)
  expect(screen.getByRole("link", { name: "Fechar caixa / dia" }).className).toContain("border-line-strong");
  expect(screen.getByRole("link", { name: "Fechar caixa / dia" }).className).not.toContain("bg-ink");
  expect(screen.queryByRole("button", { name: "Fechar caixa" })).toBeNull();
  rerender(<CashHeader name="Ana" mine={null} />);
  // dsgfix (r68 #5): fechado, nada de fechar um caixa que não abriu e nada de botão duplicado no topo
  expect(screen.queryByRole("link", { name: "Fechar caixa / dia" })).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
  expect(container.textContent).toBe("");
});

it("caixa fechado (r68 #5): só o convite para abrir; a comanda não aparece e não há erro vermelho antes de tocar", () => {
  render(<CashClosed name="Ana" canSkip={false}><p>comanda inteira</p></CashClosed>);
  expect(screen.getByRole("heading", { name: "Seu caixa está fechado" })).toBeTruthy();
  expect(screen.getByLabelText("Fundo de troco (R$)")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Abrir caixa, Ana" }).className).toContain("bg-gold");
  expect(screen.queryByText("comanda inteira")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(document.body.innerHTML).not.toContain("text-alert");
  expect(screen.queryByRole("button", { name: "Ver as comandas sem abrir o caixa" })).toBeNull();
});

it("caixa fechado sem a regra de caixa aberto: dá para ver as comandas mesmo assim", () => {
  render(<CashClosed name="Ana" canSkip><p>comanda inteira</p></CashClosed>);
  fireEvent.click(screen.getByRole("button", { name: "Ver as comandas sem abrir o caixa" }));
  expect(screen.getByText("comanda inteira")).toBeTruthy();
});
