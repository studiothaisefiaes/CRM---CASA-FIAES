// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { DayVisit, DayVisitService } from "@/lib/day-visit";

const setAppointmentStatusAction = vi.fn(async () => ({ ok: true as const, data: { changed: true } }));
vi.mock("@/app/(app)/agenda/actions", () => ({
  setAppointmentStatusAction: (...a: unknown[]) => (setAppointmentStatusAction as (...x: unknown[]) => unknown)(...a),
  dayVisitAction: vi.fn(), cancelAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
const openById = vi.fn(), openForAppointment = vi.fn();
let comanda: { openById: typeof openById; openForAppointment: typeof openForAppointment } | null = null;
vi.mock("@/components/caixa/comanda-provider", () => ({ useComanda: () => comanda }));
import { DayTable } from "./day-table";

afterEach(() => { cleanup(); setAppointmentStatusAction.mockClear(); openById.mockClear(); openForAppointment.mockClear(); comanda = null; });
const at = (hm: string) => new Date(`2026-10-17T${hm}:00-03:00`).toISOString();
const NOW = new Date(at("11:30")).getTime();
let n = 0;
const s = (status: string, o: Partial<DayVisitService> = {}): DayVisitService => ({
  appointmentId: `a${++n}`, serviceId: null, service: "Corte", professionalId: "p", pro: "Ana", assistant: null, start: at("09:00"), end: at("10:00"), status, priceCents: 10000, ...o,
});
const v = (name: string, services: DayVisitService[], o: Partial<DayVisit> = {}): DayVisit => ({
  key: name, visitId: name, contactId: name, dealId: null, name, day: "2026-10-17", entry: services[0].start, services, cancelled: [], comanda: null, values: true, ...o,
});
const VISITS = [
  v("Fabiana Otero", [s("confirmado", { service: "Avaliação", pro: "Gilvan" })]),
  v("Thamires Domingues", [s("em_atendimento", { arrivedAt: at("08:40"), service: "Manutenção Método Fiaes®", pro: "Rose" }), s("chegou"), s("compareceu", { service: "Manicure" })]),
  v("Helaine Neves", [s("agendado", { start: at("13:00"), service: "Luzes e Mechas", pro: "Thaise" })]),
  v("Suzana Melo", [s("compareceu", { service: "Escova", pro: "Jamille" })], { comanda: { id: "cm1", number: 4, status: "aberta" } }),
  v("Camilla Santos", [s("faltou", { service: "Coloração" })]),
];
const tab = (name: RegExp) => screen.getByRole("tab", { name });
const rows = () => screen.getAllByTestId("dia-linha");

it("abas com contagem e uma linha por cliente, na ordem da hora; filtrar 'Na Casa' deixa só quem está na Casa", () => {
  render(<DayTable visits={VISITS} nowMs={NOW} caixaOn={false} canMark agendaMode="dupla" />);
  expect(tab(/^Todas/).textContent).toContain("5");
  expect(tab(/^A chegar/).textContent).toContain("2");
  expect(tab(/^Na Casa/).textContent).toContain("1");
  expect(tab(/^Finalizaram/).textContent).toContain("1");
  expect(tab(/^Não vieram/).textContent).toContain("1");
  expect(rows()).toHaveLength(5);
  expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Hora", "Cliente", "Serviços e profissionais", "Situação", "Ação"]);
  fireEvent.click(tab(/^Na Casa/));
  expect(rows()).toHaveLength(1);
  expect(rows()[0].textContent).toContain("Thamires Domingues");
  expect(rows()[0].textContent).toContain("Na Casa desde 08:40");
  expect(rows()[0].textContent).toContain("1 de 3 finalizados");
});

it("situação: passou da hora sem Chegou em texto discreto (sem pílula vermelha); serviços como etiqueta com bolinha e profissional", () => {
  render(<DayTable visits={VISITS} nowMs={NOW} caixaOn={false} canMark agendaMode="dupla" />);
  const edith = rows()[0];
  const late = within(edith).getByText("passou 2h30, sem Chegou");
  expect(late.getAttribute("style")).toBeNull();
  expect(edith.textContent).not.toMatch(/atrasada/);
  const tag = within(edith).getByTestId("dia-servico");
  expect(tag.textContent).toBe("AvaliaçãoGilvan");
  expect((tag.querySelector("i") as HTMLElement).style.background).not.toBe("");
  expect(rows().find((r) => r.textContent!.includes("Helaine"))!.textContent).toContain("Marcada");
  expect(rows().find((r) => r.textContent!.includes("Camilla"))!.textContent).toContain("Não veio");
});

it("sem caixa no CRM: nada de 'falta pagar' nem Receber; com caixa: 'falta pagar' e Receber abre a comanda", () => {
  const { unmount } = render(<DayTable visits={VISITS} nowMs={NOW} caixaOn={false} canMark agendaMode="dupla" />);
  const suzana = () => rows().find((r) => r.textContent!.includes("Suzana"))!;
  expect(suzana().textContent).not.toContain("falta pagar");
  expect(within(suzana()).queryByRole("button", { name: /Receber/ })).toBeNull();
  expect(within(suzana()).getByRole("button", { name: "Abrir: Suzana Melo" })).toBeTruthy();
  unmount();
  comanda = { openById, openForAppointment };
  render(<DayTable visits={VISITS} nowMs={NOW} caixaOn canMark agendaMode="dupla" />);
  expect(suzana().textContent).toContain("falta pagar");
  fireEvent.click(within(suzana()).getByRole("button", { name: "Receber: Suzana Melo" }));
  expect(openById).toHaveBeenCalledWith("cm1");
});

it("Chegou na linha marca a visita toda (o primeiro serviço planejado) e não abre a visita", async () => {
  render(<DayTable visits={VISITS} nowMs={NOW} caixaOn={false} canMark agendaMode="dupla" />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Chegou: Fabiana Otero" })); });
  expect(setAppointmentStatusAction).toHaveBeenCalledWith(VISITS[0].services[0].appointmentId, "chegou");
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("tocar na linha (ou Enter) abre a visita que já existe", async () => {
  render(<DayTable visits={VISITS} nowMs={NOW} caixaOn={false} canMark agendaMode="dupla" />);
  await act(async () => { fireEvent.click(rows()[2]); });
  expect(screen.getByRole("dialog", { name: "Helaine Neves" })).toBeTruthy();
});
