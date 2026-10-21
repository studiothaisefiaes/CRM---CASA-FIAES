// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { Earnings } from "@/lib/pro-earnings";
import { GanhosView } from "./earnings-view";

afterEach(cleanup);
const EMPTY = { totalCents: 0, lines: [] };
const DATA: Earnings = { configured: true, today: EMPTY, month: EMPTY, waiting: [], receipts: [] };
const RECEIPTS = [{ id: "r1", number: 3, paidAt: "2026-10-01T13:00:00.000Z", netCents: 4300 }];

it("Recibos: os dela, com número, data e valor, cada um abre o recibo", () => {
  render(<GanhosView data={DATA} receipts={RECEIPTS} />);
  const sec = screen.getByRole("region", { name: "Recibos" });
  const link = within(sec).getByRole("link");
  expect(link.getAttribute("href")).toBe("/pro/ganhos/recibo/r1");
  expect((link.textContent ?? "").replace(/\s/g, " ")).toMatch(/Recibo nº 3 · 01\/10\/2026 · R\$ 43,00/);
});

it("com o caixa no Avec (sem ganhos), os recibos continuam (pagar não depende do modo)", () => {
  render(<GanhosView data={null} receipts={RECEIPTS} />);
  expect(screen.getByRole("status").textContent).toBe("Os ganhos aparecem aqui quando o caixa passar para o CRM.");
  expect(screen.getByRole("region", { name: "Recibos" })).toBeTruthy();
});

it("sem recibo: a seção não aparece", () => {
  render(<GanhosView data={DATA} receipts={[]} />);
  expect(screen.queryByRole("region", { name: "Recibos" })).toBeNull();
});

it("linha com valor: '60% de R$ X (base depois dos descontos) = R$ Y'", () => {
  const line = { id: "i1", day: "2026-10-15", client: "Paula", label: "Corte", pct: "60%", commissionCents: 5434, serviceCents: 9000, why: null };
  render(<GanhosView data={{ ...DATA, today: { totalCents: 5434, lines: [line] }, month: EMPTY }} receipts={[]} />);
  const t = (screen.getByRole("region", { name: "Hoje" }).textContent ?? "").replace(/\s/g, " ");
  expect(t).toContain("60% de R$ 90,00 (base depois dos descontos) = R$ 54,34");
});
