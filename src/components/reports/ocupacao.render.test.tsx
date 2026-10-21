// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }), useSearchParams: () => new URLSearchParams("aba=salao&vista=ocupacao&prof=x") }));
import { salonRange } from "@/lib/salon-period";
import type { OcupacaoView } from "@/server/reports/ocupacao";
import { OcupacaoTab } from "./ocupacao";
import { SalonViews } from "./salon-views";

afterEach(() => { cleanup(); replace.mockClear(); });

const range = salonRange({ periodo: "livre", de: "2026-10-12", ate: "2026-10-18" }, new Date("2026-10-15T15:00:00Z"));
const view = (o: Partial<OcupacaoView> = {}): OcupacaoView => {
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  grid[2][10] = 2; grid[2][14] = 1;
  return {
    range, money: true, medida: "horarios", professionalId: null, grid,
    professionals: [{ id: "p1", name: "Ana", availableMin: 480, bookedMin: 120, pct: 25, days: 1 }, { id: "p2", name: "Bia", availableMin: 0, bookedMin: 0, pct: null, days: 0 }],
    ...o,
  };
};

it("pergunta 'Quando a Casa enche e quem está livre?', mapa com 'horário/horários' e tabela com Ocupação %", () => {
  const { container } = render(<OcupacaoTab d={view()} />);
  expect(screen.getByRole("heading", { name: "Quando a Casa enche e quem está livre?" })).toBeTruthy();
  expect(container.textContent).toContain("terça, 10h");
  expect(container.textContent).toContain("2 horários");
  expect(container.textContent).not.toContain("mensage");
  expect(container.textContent).toContain("Disponível = horário de trabalho dela (ou o da Casa) menos bloqueios e folgas.");
  expect(screen.getAllByText("Ocupação").length).toBeGreaterThan(0);
  expect(container.textContent).toContain("25%");
  expect(container.textContent).toContain("8"); // 480 min = 8 h
  expect(container.textContent).toContain("—");
});

it("Valor só com money: o mapa escreve em reais; sem money não há botões nem R$", () => {
  const v = view({ medida: "valor" }); v.grid[2][10] = 12000;
  const { container } = render(<OcupacaoTab d={v} />);
  expect(screen.getByRole("button", { name: "Valor" }).getAttribute("aria-pressed")).toBe("true");
  expect(container.textContent).toMatch(/R\$\s*120\b/);
  cleanup();
  const sem = render(<OcupacaoTab d={view({ money: false })} />);
  expect(screen.queryByRole("button", { name: "Valor" })).toBeNull();
  expect(sem.container.textContent).not.toMatch(/R\$/);
});

it("trocar a profissional e a medida refaz a URL na vista de Ocupação", () => {
  render(<OcupacaoTab d={view()} />);
  fireEvent.change(screen.getByLabelText("Profissional"), { target: { value: "p1" } });
  expect(replace.mock.calls[0][0]).toContain("vista=ocupacao");
  expect(replace.mock.calls[0][0]).toContain("prof=p1");
  fireEvent.click(screen.getByRole("button", { name: "Valor" }));
  expect(replace.mock.calls[1][0]).toContain("medida=valor");
});

it("abas Resumo / Ocupação: Resumo tira ?vista; Ocupação põe", () => {
  render(<SalonViews value="ocupacao" />);
  fireEvent.click(screen.getByRole("tab", { name: "Resumo" }));
  expect(replace.mock.calls[0][0]).not.toContain("vista");
  expect(replace.mock.calls[0][0]).not.toContain("prof");
  expect(replace.mock.calls[0][0]).toContain("aba=salao");
});
