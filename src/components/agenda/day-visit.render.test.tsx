// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { DayVisit } from "@/lib/day-visit";

vi.mock("@/app/(app)/agenda/actions", () => ({ setAppointmentStatusAction: vi.fn(), dayVisitAction: vi.fn(), cancelAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/components/caixa/comanda-provider", () => ({ useComanda: () => null }));
import { DayVisitView } from "./day-visit";

afterEach(cleanup);
const at = (hm: string) => new Date(`2026-10-17T${hm}:00-03:00`).toISOString();

it("visita de quem passou da hora: texto discreto 'passou 2h30, sem Chegou', sem pílula vermelha de atraso (Hoje v3)", () => {
  const v: DayVisit = {
    key: "k", visitId: "v", contactId: "c", dealId: null, name: "Helena Esteves", day: "2026-10-17", entry: at("09:00"), cancelled: [], comanda: null, values: false,
    services: [{ appointmentId: "a1", serviceId: null, service: "Avaliação", professionalId: "p", pro: "Gilvan", assistant: null, start: at("09:00"), end: at("10:00"), status: "confirmado", priceCents: null }],
  };
  render(<DayVisitView data={{ visit: v, canMark: true, agendaMode: "dupla" }} nowMs={new Date(at("11:30")).getTime()} onChanged={() => {}} />);
  const late = screen.getByText("passou 2h30, sem Chegou");
  expect(late.getAttribute("style")).toBeNull();
  expect(screen.queryByText(/atrasada/)).toBeNull();
});
