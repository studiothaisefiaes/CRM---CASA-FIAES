// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { WeekByPro } from "./week-by-pro";

afterEach(cleanup);
const DAYS = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"];

it("uma linha por profissional, uma coluna por dia: clientes e horas, ou Folga; tocar abre o dia dela", () => {
  render(<WeekByPro today="2026-10-29" days={DAYS} rows={[{ professionalId: "p1", name: "Ana", active: true,
    cells: DAYS.map((d) => ({ day: d, clients: d === "2026-10-31" ? 2 : 0, minutes: d === "2026-10-31" ? 105 : 0, off: d === "2026-10-26" })) }]} />);
  expect(screen.getByRole("link", { name: "Ana, 2026-10-31: 2 clientes, 1h45" }).getAttribute("href")).toBe("/agenda?d=2026-10-31&v=profissionais&p=p1");
  expect(screen.getByRole("link", { name: "Ana, 2026-10-26: folga" }).textContent).toBe("Folga");
});
