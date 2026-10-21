// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
import { salonRange } from "@/lib/salon-period";
import type { SalonView } from "@/server/reports/salon";
import { SalonTab } from "./salon";

afterEach(cleanup);

const range = salonRange({ periodo: "mes-passado" }, new Date("2026-10-15T15:00:00Z"));
const view = (money: boolean): SalonView => {
  const c = (v: number) => (money ? v : null);
  return {
    range, avecUntil: "2026-10-14", money,
    revenue: { cents: c(37345), prevCents: c(10000), comandas: 2, prevComandas: 1, ticketCents: c(18673), prevTicketCents: c(10000),
      series: [{ key: "2026-09-02", label: "02/09", cents: c(25000), comandas: 1 }, { key: "2026-09-03", label: "03/09", cents: c(12345), comandas: 1 }] },
    professionals: [{ key: "p1", name: "MAIARA TESTE", comandas: 1, itens: 1, cents: c(25000), ticketCents: c(25000), commissionCents: null }],
    services: { items: [{ item: "Corte Teste", category: "CABELO", n: 1, cents: c(25000) }], otherItems: { count: 0, n: 0, cents: c(0) }, categories: [{ category: "CABELO", n: 2, cents: c(37345) }] },
    payments: [{ method: "Pix", n: 1, cents: c(25000) }],
    clients: { novas: 1, recorrentes: 1, previous: { novas: 0, recorrentes: 1 } },
    attendance: {
      rows: [{ key: "sem", name: "Sem profissional", compareceu: 1, faltou: 0, cancelado: 0, semDesfecho: 1 }], total: { compareceu: 1, faltou: 0, cancelado: 0, semDesfecho: 1 },
      noOutcome: { n: 1, items: [{ id: "a2", startsAt: "2026-09-05T13:00:00.000Z", clientName: "Bia Teste", contactId: "c1", professional: null, service: "Escova Teste" }] },
    },
    funnel: { conversas: 4, comHorario: 2, compareceram: 1, compraram: 1 },
  };
};

it("com valores: faturamento, comissão 'não importada', a fonte do Avec e a agenda sem desfecho abrindo a ficha", () => {
  const { container } = render(<SalonTab d={view(true)} />);
  expect(screen.getByRole("heading", { name: "Faturamento" })).toBeTruthy();
  expect(container.textContent).toMatch(/R\$\s373,45/);
  expect(container.textContent).toContain("não importada");
  expect(screen.getByTestId("fonte-salao").textContent).toContain("Fonte: Avec até 14/10/2026");
  expect(container.querySelector('a[href="/contatos/c1"]')).toBeTruthy();
});

it("sem valores: nenhum R$ na tela, só quantidades", () => {
  const { container } = render(<SalonTab d={view(false)} />);
  expect(screen.getByRole("heading", { name: "Comandas" })).toBeTruthy();
  expect(container.textContent).not.toMatch(/R\$/);
  expect(container.textContent).toContain("MAIARA TESTE");
});

it("o Resumo continua igual: SalonTab não ganha abas por conta própria", () => {
  render(<SalonTab d={view(true)} />);
  expect(screen.queryByRole("tab", { name: "Ocupação" })).toBeNull();
});
