// @vitest-environment jsdom
import { it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { NextAction } from "./next-action";
import type { DealDetail } from "@/server/queries/deal";
import type { LeadActions } from "./use-lead-actions";
afterEach(cleanup);

it("na conversa: combinado vencido e a Casa já escreveu depois → 'Marcar como feito' com um toque", () => {
  const now = Date.now();
  const d = { nextAction: { id: "t1", title: "Mandar valores", dueAt: new Date(now - 3 * 3_600_000).toISOString(), assigneeName: "Sara" },
    deal: { lastOutboundAt: new Date(now - 3_600_000).toISOString() } } as unknown as DealDetail;
  render(<NextAction d={d} actions={{ busy: false, completeTask: () => {}, open: () => {} } as unknown as LeadActions} />);
  expect(screen.getByRole("button", { name: /Marcar como feito/ })).toBeTruthy();
  expect(screen.getByText(/A Casa já escreveu depois/)).toBeTruthy();
  expect(screen.getByTestId("proxima-acao-quando").textContent).toMatch(/^atrasado · /); // "combinado" é masculino
});
