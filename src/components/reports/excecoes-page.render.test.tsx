// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), useSearchParams: () => new URLSearchParams("tipo=sangria") }));
import { salonRange } from "@/lib/salon-period";
import type { FinanceException } from "@/server/reports/financeiro";
import { ExcecoesPage } from "./excecoes-page";

afterEach(cleanup);
const range = salonRange({ de: "2026-10-01", ate: "2026-10-15" }, new Date("2026-10-15T15:00:00Z"));
const base: FinanceException = { origin: "crm", kind: "sangria", day: "2026-10-15", at: "2026-10-15T15:00:00.000Z", comanda: null, client: null, item: null, who: "Cati", beforeCents: null, afterCents: null, valueCents: 100, reason: "banco" };
const many = Array.from({ length: 70 }, (_, i) => ({ ...base, reason: `motivo ${i}` }));

describe("página de Exceções", () => {
  it("lista tudo, sem o corte de 60, e o filtro mostra a contagem por tipo", () => {
    const { container } = render(<ExcecoesPage range={range} exceptions={[...many, { ...base, kind: "cortesia" }]} tipo={null} />);
    expect(container.querySelectorAll("tbody tr").length).toBe(71);
    expect(screen.getByRole("option", { name: "Sangria (70)" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Cortesia (1)" })).toBeTruthy();
  });
  it("filtrada por tipo mostra só aquele tipo", () => {
    const { container } = render(<ExcecoesPage range={range} exceptions={[...many, { ...base, kind: "cortesia" }]} tipo="cortesia" />);
    expect(container.querySelectorAll("tbody tr").length).toBe(1);
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("cortesia");
  });
  it("vazia: avisa", () => {
    render(<ExcecoesPage range={range} exceptions={[]} tipo={null} />);
    expect(screen.getByText("Nenhuma exceção no período.")).toBeTruthy();
  });
});
