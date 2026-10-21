// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TeamCash } from "./team-cash";
import type { TeamCashRow } from "@/server/queries/caixa";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(app)/caixa/actions", () => ({ closeCashAction: vi.fn(), reopenCashAction: vi.fn() }));
const rec = { dinheiro: 0, pix: 0, credito: 0, debito: 0, outra: 0, cortesia: 0 };
const row = (id: string, status: "aberto" | "fechado", personId: string, personName: string): TeamCashRow => ({
  id, personId, personName, day: "2026-10-15", status, openedAt: "2026-10-15T12:00:00Z", closedAt: status === "fechado" ? "2026-10-15T20:00:00Z" : null, openingCents: 0,
  received: rec as TeamCashRow["received"], expectedCash: 0, differenceCents: status === "fechado" ? 0 : null, approvedByName: null, closedByName: null,
  expected: {} as TeamCashRow["expected"], byBrand: [], openComandas: 0, differences: [],
});
const rows = [row("a", "aberto", "p2", "Bia"), row("b", "fechado", "p3", "Cati")];

afterEach(cleanup);
describe("TeamCash: botões de gestão", () => {
  it("sem caixa.gerir, não oferece fechar o de outra pessoa nem reabrir", () => {
    render(<TeamCash rows={rows} viewerId="p1" hasOptions canGerir={false} />);
    expect(screen.queryByText("Fechar o caixa de Bia")).toBeNull();
    expect(screen.queryByRole("button", { name: /Reabrir/ })).toBeNull();
  });
  it("com caixa.gerir, oferece os dois", () => {
    render(<TeamCash rows={rows} viewerId="p1" hasOptions canGerir />);
    expect(screen.getByText("Fechar o caixa de Bia")).toBeTruthy();
    // r68 #15: um "Reabrir" para a tabela inteira, não um por linha
    expect(screen.getAllByRole("button", { name: /Reabrir/ }).map((b) => b.textContent)).toEqual(["Reabrir um caixa"]);
  });
});
