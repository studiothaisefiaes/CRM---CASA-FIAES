// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock("../agenda-sheets", () => ({ useAgendaSheets: () => ({ catalog: null, book: () => {} }), canBookIn: () => false }));
vi.mock("./pending", () => ({ PendingPanel: () => null }));
vi.mock("../agenda-search", () => ({ AgendaSearch: () => null }));
vi.mock("../block-sheet", () => ({ BlockSheet: () => null }));
vi.mock("../slot-finder", () => ({ SlotFinder: () => null }));
vi.mock("../transfer-day-sheet", () => ({
  TransferDaySheet: ({ open, day, pros }: { open: boolean; day: string; pros: { name: string }[] }) => (open ? <div role="dialog" aria-label="Passar o dia">{`${day} ${pros.map((p) => p.name).join(",")}`}</div> : null),
}));
import { AgendaShell, type ShellNav } from "./shell";

afterEach(cleanup);
const NAV: ShellNav = { title: "Sexta, 16 de outubro", shortTitle: "Sex, 16/10", prevHref: "/agenda?d=2026-10-15", nextHref: "/agenda?d=2026-10-17", prevLabel: "Dia anterior", nextLabel: "Próximo dia",
  todayHref: null, view: "dia", dayHref: "/agenda", weekHref: "/agenda?v=semana", listHref: "/agenda?v=lista" };
const PENDING = { noBaixa: [], waitlistCount: 0, faltaPagar: [], pedidosCount: 0, confirmByPhone: null } as unknown as Parameters<typeof AgendaShell>[0]["pending"];
const shell = (transfer: Parameters<typeof AgendaShell>[0]["transfer"]) => render(
  <AgendaShell nav={NAV} day="2026-10-16" nowMs={0} isToday={false} tools={null} transfer={transfer} pending={PENDING} initialPending={null} personalize={false}><p>grade</p></AgendaShell>,
);

it("'Passar o dia de uma profissional' fica em Mais ações da agenda e abre a folha; sem permissão ou função desligada, some", async () => {
  shell({ day: "2026-10-16", pros: [{ id: "a", name: "Ana" }, { id: "b", name: "Bia" }] });
  fireEvent.click(screen.getByRole("button", { name: "Mais ações da agenda" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /Passar o dia de uma profissional/ }));
  expect(screen.getByRole("dialog", { name: "Passar o dia" }).textContent).toBe("2026-10-16 Ana,Bia");
  cleanup();
  shell(null);
  fireEvent.click(screen.getByRole("button", { name: "Mais ações da agenda" }));
  await screen.findByRole("menuitem", { name: /Ver o dia em lista/ });
  expect(screen.queryByRole("menuitem", { name: /Passar o dia/ })).toBeNull();
});
