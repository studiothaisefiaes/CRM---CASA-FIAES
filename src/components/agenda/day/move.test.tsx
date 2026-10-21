// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AgendaItem } from "@/server/queries/agenda";
import { instantOf } from "@/lib/agenda";
vi.mock("@/app/(app)/agenda/actions", () => ({
  dayVisitAction: vi.fn(async () => ({ ok: true, data: { visit: null, canMark: true, agendaMode: "dupla" } })), setAppointmentStatusAction: vi.fn(), undoStatusAction: vi.fn(), notesAction: vi.fn() }));
vi.mock("@/app/(app)/funil/actions", () => ({ setAttendanceAction: vi.fn() }));
vi.mock("@/app/(app)/conversa/actions", () => ({ resolveAction: vi.fn(), undoResolveAction: vi.fn() }));
vi.mock("@/app/(app)/conversa/ai-actions", () => ({ aiProgramadaAction: vi.fn(), aiProgramadaAvailableAction: vi.fn(async () => ({ ok: true, data: false })) }));
vi.mock("@/app/(app)/atendimento/programadas/actions", () => ({ editScheduledAction: vi.fn() }));
import type { PlaceCtx } from "@/lib/agenda-day";
import { MoveConfirm, MovePicker, type MoveRequest } from "./move";
import type { DayPro } from "./day-grid";

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(cleanup);

const DAY = "2026-10-17";
const pro = (id: string, name: string, over: Partial<DayPro> = {}): DayPro => ({ id, name, role: null, color: null, photoUrl: null, ranges: [[540, 1080]], off: false, serviceIds: ["s1"], ...over });
const PROS = [pro("liv", "Lívia Santos"), pro("hel", "Heloísa Prado"), pro("kat", "Kátia Reis", { off: true })];
const item = (over: Partial<AgendaItem> = {}): AgendaItem => ({
  key: "ag:1", source: "agendamento", dealId: null, appointmentId: "11111111-1111-4111-8111-111111111111", visitId: "v1", contactId: "c1", name: "Mirela Campos", phone: null,
  hasAvatar: false, scheduledAt: instantOf(DAY, 600).toISOString(), durationMin: 60, durationEstimated: false, noTime: false, service: "Corte", serviceId: "s1", ownerName: null,
  professionalId: "liv", professionalName: "Lívia Santos", stageName: null, status: "agendado", dbStatus: "agendado", origin: "avec", notes: null, bookedBy: null, paid: false,
  firstVisit: false, anyPro: false, fitIn: false, outsideHours: false, confirmedVia: null, cancelReason: null, professionalColor: null, preference: "escolhida", ...over,
});
const req = (over: Partial<MoveRequest> = {}): MoveRequest => ({ item: item(), to: "hel", t: 14 * 60, avisar: false, ...over });

it("pergunta 'Passar … para a … às …?', lembra do Avec no modo dupla e da preferência; Avisar vem desligado", () => {
  const onConfirm = vi.fn(), onChange = vi.fn();
  render(<MoveConfirm req={req()} pending={false} pros={PROS} mode="dupla" onChange={onChange} onCancel={() => {}} onConfirm={onConfirm} />);
  expect(screen.getByRole("dialog", { name: "Passar Mirela para a Heloísa às 14:00?" })).toBeTruthy();
  expect(screen.getByText("Corte, 1h. Estava às 10:00 com a Lívia.")).toBeTruthy();
  expect(screen.getByText("Ela pediu a Lívia. Confirme a troca com ela.")).toBeTruthy();
  expect(screen.getByText("Este horário veio do Avec. Enquanto o Avec estiver ligado, mude também lá.")).toBeTruthy();
  const sw = screen.getByRole("switch", { name: "Avisar a cliente" });
  expect(sw.getAttribute("aria-checked")).toBe("false");
  expect(screen.getByText("Nenhuma mensagem é preparada nem enviada.")).toBeTruthy();
  fireEvent.click(sw);
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ avisar: true }));
  fireEvent.click(screen.getByRole("button", { name: "Passar" }));
  expect(onConfirm).toHaveBeenCalledWith(req());
});

it("na mesma profissional é 'Mudar … para as …?'; fora do modo dupla, sem o lembrete do Avec", () => {
  render(<MoveConfirm req={req({ to: "liv", avisar: true })} pending={false} pros={PROS} mode="so_crm" onChange={() => {}} onCancel={() => {}} onConfirm={() => {}} />);
  expect(screen.getByRole("dialog", { name: "Mudar Mirela para as 14:00?" })).toBeTruthy();
  expect(screen.queryByText(/mude também lá/)).toBeNull();
  expect(screen.queryByText(/Ela pediu a/)).toBeNull();
  expect(screen.getByText("A mensagem fica pronta na conversa; quem envia é você.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Mudar" })).toBeTruthy();
});

it("Mover…: escolhe a pessoa (folga fica de fora) e só oferece as horas em que ela está livre", () => {
  const ctx: PlaceCtx = {
    nowMs: instantOf("2026-10-16", 600).getTime(), day: DAY, today: "2026-10-16", names: { liv: "Lívia Santos", hel: "Heloísa Prado", kat: "Kátia Reis" },
    hours: { liv: { ranges: [[540, 1080]], off: false }, hel: { ranges: [[540, 1080]], off: false }, kat: { ranges: [], off: true } },
    blocks: [{ professionalId: "hel", start: 720, end: 780, title: "Almoço" }],
    items: [item(), item({ key: "ag:2", professionalId: "hel", name: "Ana Souza", scheduledAt: instantOf(DAY, 540).toISOString(), durationMin: 120 })],
  };
  const onPick = vi.fn();
  render(<MovePicker item={item()} onClose={() => {}} pros={PROS} ctx={ctx} onPick={onPick} />);
  const quem = screen.getByRole("group", { name: "Para quem" });
  expect([...quem.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["LSLívia, agora", "HPHeloísa"]);
  fireEvent.click(screen.getByRole("button", { name: /Heloísa/ }));
  const horas = [...screen.getByRole("group", { name: "Hora" }).querySelectorAll("button")].map((b) => b.textContent);
  expect(horas[0]).toBe("11:00"); // Ana até as 11:00
  expect(horas).not.toContain("12:00"); // almoço
  fireEvent.click(screen.getByRole("button", { name: "13:00" }));
  expect(onPick).toHaveBeenCalledWith("hel", 13 * 60);
});
