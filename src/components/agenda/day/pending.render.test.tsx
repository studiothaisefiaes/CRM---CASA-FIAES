// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { AgendaItem } from "@/server/queries/agenda";
import { instantOf } from "@/lib/agenda";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(app)/agenda/actions", () => ({
  dayVisitAction: vi.fn(async () => ({ ok: true, data: { visit: null, canMark: true, agendaMode: "dupla" } })), createClientLinkAction: vi.fn(), markManyAction: vi.fn(), toWaitlistManyAction: vi.fn(), undoManyAction: vi.fn(), setAppointmentStatusAction: vi.fn(), undoStatusAction: vi.fn(), notesAction: vi.fn() }));
vi.mock("@/app/(app)/caixa/actions", () => ({ openComandaAction: vi.fn() }));
vi.mock("@/app/(app)/contatos/actions", () => ({ startConversationAction: vi.fn(), unignoreContactAction: vi.fn() }));
vi.mock("@/app/(app)/agenda/profissional-actions", () => ({ entryExtrasAction: vi.fn(), addNoteForProAction: vi.fn(), decideLeaveAction: vi.fn() }));
vi.mock("@/app/(app)/funil/actions", () => ({ setAttendanceAction: vi.fn() }));
vi.mock("@/app/(app)/conversa/actions", () => ({ resolveAction: vi.fn(), undoResolveAction: vi.fn() }));
vi.mock("@/app/(app)/conversa/ai-actions", () => ({ aiProgramadaAction: vi.fn(), aiProgramadaAvailableAction: vi.fn(async () => ({ ok: true, data: false })) }));
vi.mock("@/app/(app)/atendimento/programadas/actions", () => ({ editScheduledAction: vi.fn() }));
import { NoBaixaList } from "./pending";
afterEach(cleanup);

const NOW = Date.parse("2026-10-17T18:00:00Z"); // sábado 15:00 em Salvador
let n = 0;
const item = (day: string, min: number): AgendaItem => ({
  key: `ag:${++n}`, source: "agendamento", dealId: null, appointmentId: `a${n}`, visitId: null, contactId: null, name: `Cliente ${n}`, phone: null, hasAvatar: false,
  scheduledAt: instantOf(day, min).toISOString(), durationMin: 60, durationEstimated: false, noTime: false, service: "Escova", serviceId: null, ownerName: null,
  professionalId: null, professionalName: null, professionalColor: null, stageName: null, status: "conferir", dbStatus: "agendado", origin: "avec", notes: null, bookedBy: null,
  paid: false, firstVisit: false, anyPro: false, fitIn: false, outsideHours: false, confirmedVia: null, cancelReason: null,
});

it("Sem baixa da semana: contador no alto e por dia, do mais recente ao mais antigo (5 dias atrás aparece)", () => {
  render(<NoBaixaList nowMs={NOW} items={[item("2026-10-12", 600), item("2026-10-12", 660), item("2026-10-16", 600), item("2026-10-17", 540)]} />);
  expect(screen.getByText("4 horários sem desfecho nos últimos 7 dias.")).toBeTruthy();
  const dias = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
  expect(dias).toEqual(["Hoje, sábado 17/10 · 1", "Ontem, sexta 16/10 · 1", "Segunda 12/10 · 2"]);
});

it("nada sem baixa: diz que a semana está em dia", () => {
  render(<NoBaixaList nowMs={NOW} items={[]} />);
  expect(screen.getByText("Nada pendente nos últimos 7 dias.")).toBeTruthy();
});
