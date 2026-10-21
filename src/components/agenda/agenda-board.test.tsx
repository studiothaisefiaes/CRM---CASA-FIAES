// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { AgendaItem } from "@/server/queries/agenda";

vi.mock("@/app/(app)/agenda/actions", () => ({
  dayVisitAction: vi.fn(async () => ({ ok: true, data: { visit: null, canMark: true, agendaMode: "dupla" } })), setAppointmentStatusAction: vi.fn() }));
vi.mock("@/app/(app)/funil/actions", () => ({ setAttendanceAction: vi.fn() }));
// use-lead-actions (attendanceToast) importa as ações da conversa do Lote 5 ("Resolvido").
vi.mock("@/app/(app)/conversa/actions", () => ({ resolveAction: vi.fn(), undoResolveAction: vi.fn() }));
vi.mock("@/app/(app)/conversa/ai-actions", () => ({ aiProgramadaAction: vi.fn(), aiProgramadaAvailableAction: vi.fn(async () => ({ ok: true, data: false })) }));
vi.mock("@/app/(app)/atendimento/programadas/actions", () => ({ editScheduledAction: vi.fn() }));
// 6C: a comanda (folha e ações do servidor) fica fora destes testes; sem o provider, o botão some.
vi.mock("@/components/caixa/comanda-provider", () => ({ useComanda: () => null }));
vi.mock("@/app/(app)/agenda/profissional-actions", () => ({ entryExtrasAction: vi.fn(async () => ({ ok: false, error: "" })), addNoteForProAction: vi.fn(), decideLeaveAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AgendaBoard } from "./agenda-board";

afterEach(cleanup);

const at = (h: number) => new Date(Date.UTC(2026, 9, 14, h + 3)).toISOString();
const base: AgendaItem = {
  key: "lead:d1", source: "lead", dealId: "d1", appointmentId: null, contactId: "c1", name: "Lead Teste", phone: "+5571999990000", hasAvatar: false,
  scheduledAt: at(9), durationMin: 60, durationEstimated: true, noTime: false, service: "Escova", ownerName: "Ana Lima", professionalId: null, professionalName: null,
  stageName: "Agendado", status: "agendado", origin: "crm", notes: null, bookedBy: null,
  visitId: null, serviceId: null, dbStatus: null, paid: false, firstVisit: false, anyPro: false, fitIn: false, outsideHours: false, confirmedVia: null, cancelReason: null,
  professionalColor: null,
};

it("Dia junta lead e agendamento do Avec: lead e agendamento abrem a folha (com Abrir conversa e Abrir ficha); cancelado sem hora aparece riscado", () => {
  render(<AgendaBoard view="lista" days={["2026-10-14"]} today="2026-10-13" nowMs={Date.UTC(2026, 9, 13, 12)} items={[
    { ...base, key: "ag:x", source: "agendamento", dealId: null, appointmentId: "x", contactId: null, name: "Cancelou", noTime: true, status: "cancelado", dbStatus: "cancelado", origin: "avec", scheduledAt: at(0) },
    base,
    { ...base, key: "ag:y", source: "agendamento", dealId: null, appointmentId: "y", contactId: null, name: "Do Avec", durationMin: 45, durationEstimated: false, dbStatus: "agendado", origin: "avec", scheduledAt: at(11) },
  ]} />);
  expect(screen.getByRole("button", { name: /Lead Teste/ }).getAttribute("aria-haspopup")).toBe("dialog"); // Lote 2: o nome abre o painel (Abrir conversa e Abrir ficha da cliente)
  expect(screen.getByRole("button", { name: /Do Avec/ }).getAttribute("aria-haspopup")).toBe("dialog");
  expect(screen.getByText("sem hora")).toBeTruthy();
  expect(screen.getByText("Cancelou").className).toContain("line-through");
  expect(screen.getByText("~1h")).toBeTruthy(); // estimado
  expect(screen.getByText("45 min")).toBeTruthy();
  expect(screen.getAllByTitle("Veio do Avec")).toHaveLength(2);
});

it("lead da agenda diz com quem está a conversa (não confunde com a profissional)", () => {
  render(<AgendaBoard view="lista" days={["2026-10-14"]} today="2026-10-13" nowMs={Date.UTC(2026, 9, 13, 12)} items={[
    base,
    { ...base, key: "lead:d2", dealId: "d2", name: "Sem Dona", ownerName: null, scheduledAt: at(10) },
  ]} />);
  expect(screen.getByText(/Conversa com: Ana/)).toBeTruthy();
  expect(screen.getByText(/Conversa sem dono/)).toBeTruthy();
  expect(screen.queryByText(/atende:/)).toBeNull();
});
