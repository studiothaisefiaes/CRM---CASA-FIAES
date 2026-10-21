// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
vi.mock("@/app/(app)/funil/actions", () => ({ completeTaskAction: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { NextActions } from "./next-actions";
afterEach(cleanup);

it("combinado vencido que a Casa já respondeu: avisa e o botão vira 'Marcar como feito'", () => {
  const now = Date.parse("2026-10-15T15:00:00Z");
  render(<NextActions nowMs={now} items={[
    { id: "t1", title: "Mandar valores", kind: "proxima_acao", dueAt: "2026-10-15T12:00:00Z", overdue: true, dealId: "d1", contactId: "c1", name: "Ana", answeredAfter: true },
    { id: "t2", title: "Retomar", kind: "proxima_acao", dueAt: "2026-10-15T12:00:00Z", overdue: true, dealId: "d2", contactId: "c2", name: "Bia", answeredAfter: false },
  ]} />);
  expect(screen.getByRole("button", { name: "Marcar como feito: Mandar valores" })).toBeTruthy();
  expect(screen.getByText(/A Casa já escreveu depois/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Concluir: Retomar" })).toBeTruthy();
  expect(screen.getAllByText(/^atrasado /)).toHaveLength(2); // "combinado" é masculino
  expect(screen.queryByText(/atrasada/)).toBeNull();
});

it("com a aba da gestão: Meus · Sem responsável (o bloco é Meus combinados)", async () => {
  const { NextActionsPanel } = await import("./next-actions");
  const now = Date.parse("2026-10-15T15:00:00Z");
  render(<NextActionsPanel mine={[]} unassigned={[]} nowMs={now} idPrefix="t" />);
  expect(screen.getAllByRole("tab").map((t) => t.textContent?.replace(/\d+/g, "").trim())).toEqual(["Meus", "Sem responsável"]);
});
