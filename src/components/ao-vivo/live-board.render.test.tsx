// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { DayVisit, DayVisitService } from "@/lib/day-visit";
import type { LiveBoardData } from "@/server/queries/ao-vivo";

vi.mock("@/app/(app)/agenda/actions", () => ({ setAppointmentStatusAction: vi.fn(), dayVisitAction: vi.fn(async () => ({ ok: true, data: { visit: null, canMark: false, agendaMode: "dupla" } })), cancelAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/components/caixa/comanda-provider", () => ({ useComanda: () => null }));
import { LiveBoard } from "./live-board";

afterEach(cleanup);
const at = (hm: string) => new Date(`2026-10-17T${hm}:00-03:00`).toISOString();
const NOW = Date.parse(at("10:20"));
let n = 0;
const s = (o: Partial<DayVisitService> & { start: string }): DayVisitService => ({
  appointmentId: `a${++n}`, serviceId: null, service: "Corte", professionalId: "thaise", pro: "Thaise", assistant: null, end: null, status: "agendado", priceCents: null, ...o,
});
const v = (name: string, services: DayVisitService[], o: Partial<DayVisit> = {}): DayVisit => ({
  key: name, visitId: name, contactId: null, dealId: null, name, day: "2026-10-17", entry: services[0].start, services, cancelled: [], comanda: null, values: false, ...o,
});
const agora = s({ start: at("10:00"), end: at("11:00"), status: "em_atendimento", service: "LUZES E MECHAS" });
const DATA: LiveBoardData = {
  day: "2026-10-17",
  pros: [
    { id: "thaise", name: "Thaise", photoUrl: null, color: null, assistantOf: null },
    { id: "sidney", name: "Sidney", photoUrl: null, color: null, assistantOf: "thaise" },
  ],
  startedAt: { [agora.appointmentId]: at("10:00") },
  visits: [
    v("Yara Duarte", [agora]),
    v("Larissa Couto", [s({ start: at("10:30"), professionalId: "sidney", assistant: "Sidney", service: "escova" })]),
    v("Rita Souza", [s({ start: at("13:00") })]),
    v("Bruna Lima", [s({ start: at("15:00") })]),
    v("Paula Atrasada", [s({ start: at("09:30"), professionalId: null, pro: null })]),
    v("Celia Chegou", [s({ start: at("10:10"), status: "chegou", professionalId: null, pro: null })]),
    v("Dora Pronta", [s({ start: at("08:00"), status: "compareceu", professionalId: null, pro: null })]),
  ],
};

describe("Ao vivo: a tela da recepção", () => {
  it("coluna da principal com a assistente: Agora com tempo e barra, Próxima e Depois", () => {
    render(<LiveBoard data={DATA} nowMs={NOW} frozen caixaOn />);
    const col = screen.getByRole("region", { name: "Thaise" });
    expect(within(col).getByText("com Sidney")).toBeTruthy();
    const now = within(col).getByTestId("agora");
    expect(within(now).getByText("Yara Duarte")).toBeTruthy();
    expect(within(now).getByText("Luzes e Mechas")).toBeTruthy();
    expect(within(now).getByText("há 20 min")).toBeTruthy();
    expect(within(now).getByText("faltam 40 min")).toBeTruthy();
    expect(within(now).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("33");
    const next = within(col).getByTestId("proxima");
    expect(within(next).getByText("10:30")).toBeTruthy();
    expect(within(next).getByText("Larissa Couto")).toBeTruthy();
    expect(within(next).getByText(/Escova/)).toBeTruthy();
    expect(within(col).getByText("Depois: 2 clientes")).toBeTruthy();
    // A próxima que passou da hora sem Chegou: texto discreto, sem cor de alerta.
    expect(within(screen.getByRole("region", { name: "Sem profissional" })).getByText("passou 50 min, sem Chegou").className).toContain("text-muted");
  });

  it("o topo: atrasadas (discreto), esperando começar e a receber; Tela cheia", () => {
    Object.defineProperty(document, "fullscreenEnabled", { value: true, configurable: true });
    render(<LiveBoard data={DATA} nowMs={NOW} frozen caixaOn />);
    const top = screen.getByRole("region", { name: "Agora na Casa" });
    expect(within(top).getByTestId("topo-atrasadas").textContent).toContain("1 atrasada para chegar");
    expect(within(top).getByTestId("topo-esperando").textContent).toContain("1 esperando começar");
    expect(within(top).getByTestId("topo-receber").textContent).toContain("1 a receber");
    expect(screen.getByRole("button", { name: "Tela cheia" })).toBeTruthy();
  });

  it("sem o caixa no CRM, não há 'a receber'; sem a Fullscreen API (iPhone), não há o botão", () => {
    Object.defineProperty(document, "fullscreenEnabled", { value: false, configurable: true });
    render(<LiveBoard data={DATA} nowMs={NOW} frozen caixaOn={false} />);
    expect(screen.queryByTestId("topo-receber")).toBeNull();
    expect(screen.queryByRole("button", { name: "Tela cheia" })).toBeNull();
  });

  it("tocar na cliente abre a visita do dia", () => {
    render(<LiveBoard data={DATA} nowMs={NOW} frozen caixaOn />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir a visita de Yara Duarte" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
