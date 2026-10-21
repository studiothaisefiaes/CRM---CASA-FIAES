// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { organizeAvecReports, type AvecReportLite } from "@/lib/avec-catalog";
import { AvecCatalogView } from "./catalog";

afterEach(cleanup);

it("cartões dos principais, selo 'Virou dado no CRM', assunto recolhido e 'Vazios (N)' no fim", () => {
  const base = { rowCount: 10, dateFrom: "2026-01-01", dateTo: "2026-10-14", importedAt: "2026-10-14T12:00:00Z", fileName: "x.xlsx", importedByName: null };
  const list: (AvecReportLite & { fileName: string; importedByName: string | null })[] = [
    { ...base, id: "a", title: "Reservas", applied: { agendamentos: 5 } },
    { ...base, id: "b", title: "Bloqueios de agenda", applied: {} },
    { ...base, id: "c", title: "Cheques", rowCount: 0, applied: {} },
  ];
  const catalog = organizeAvecReports(list);
  const { container } = render(<AvecCatalogView catalog={catalog} />);
  expect(container.querySelectorAll("[data-card]")).toHaveLength(11);
  expect(screen.getAllByText("Virou dado no CRM").length).toBeGreaterThan(0);
  expect(container.querySelector('a[href="/relatorios/avec/a"]')).toBeTruthy();
  const agenda = screen.getByText("Agenda").closest("details")!;
  expect(agenda.hasAttribute("open")).toBe(false);
  expect(screen.getByText("Vazios (1)")).toBeTruthy();
});
