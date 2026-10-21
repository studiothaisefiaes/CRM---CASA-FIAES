// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AgendaItem } from "@/server/queries/agenda";

const setAppointmentStatusAction = vi.fn(async () => ({ ok: true as const, data: { changed: true } }));
const setAppointmentLabelAction = vi.fn(async (..._a: unknown[]) => ({ ok: true as const }));
const setVisitTypeAction = vi.fn(async (..._a: unknown[]) => ({ ok: true as const }));
vi.mock("@/app/(app)/agenda/actions", () => ({
  dayVisitAction: vi.fn(async () => ({ ok: true, data: { visit: null, canMark: true, agendaMode: "dupla" } })),
  setAppointmentStatusAction: (...a: unknown[]) => (setAppointmentStatusAction as (...x: unknown[]) => unknown)(...a),
  setAppointmentLabelAction: (...a: unknown[]) => setAppointmentLabelAction(...a), setVisitTypeAction: (...a: unknown[]) => setVisitTypeAction(...a),
  undoStatusAction: vi.fn(), notesAction: vi.fn(), cancelAction: vi.fn(), freeSlotsAction: vi.fn(async () => ({ ok: true, data: null })),
  createVisitAction: vi.fn(), rescheduleAction: vi.fn(), resolveWaitlistAction: vi.fn(), searchClientsAction: vi.fn(async () => ({ ok: true, data: [] })),
}));
vi.mock("@/app/(app)/funil/actions", () => ({ setAttendanceAction: vi.fn() }));
// use-lead-actions (attendanceToast) importa as ações da conversa do Lote 5 ("Resolvido").
vi.mock("@/app/(app)/conversa/actions", () => ({ resolveAction: vi.fn(), undoResolveAction: vi.fn() }));
vi.mock("@/app/(app)/conversa/ai-actions", () => ({ aiProgramadaAction: vi.fn(), aiProgramadaAvailableAction: vi.fn(async () => ({ ok: true, data: false })) }));
vi.mock("@/app/(app)/atendimento/programadas/actions", () => ({ editScheduledAction: vi.fn() }));
vi.mock("@/app/(app)/agenda/profissional-actions", () => ({ entryExtrasAction: vi.fn(async () => ({ ok: false, error: "" })), addNoteForProAction: vi.fn(), decideLeaveAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
const openForAppointment = vi.fn();
vi.mock("@/components/caixa/comanda-provider", () => ({ useComanda: () => ({ openForAppointment, openById: vi.fn() }) }));
import { AgendaSheetsProvider, type AgendaCatalog } from "./agenda-sheets";
import { EntrySheet } from "./entry-sheet";
import { useAgendaActions } from "./use-agenda-actions";

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(() => { cleanup(); setAppointmentStatusAction.mockClear(); });

const CATALOG: AgendaCatalog = {
  services: [{ id: "s1", label: "Corte", durationMin: 60 }], professionals: [{ id: "p1", name: "Ana", active: true, serviceIds: ["s1"] }],
  canMark: true, canFitIn: true, canEditConfig: false, agendaMode: "dupla",
};
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 16, h + 3, m)).toISOString();
const item = (over: Partial<AgendaItem> = {}): AgendaItem => ({
  key: "ag:1", source: "agendamento", dealId: null, appointmentId: "11111111-1111-4111-8111-111111111111", visitId: "v1", contactId: "c1", name: "Paula Souza", phone: null,
  hasAvatar: false, scheduledAt: at(10), durationMin: 60, durationEstimated: false, noTime: false, service: "Corte", serviceId: "s1", ownerName: null, professionalId: "p1",
  professionalName: "Ana", stageName: null, status: "agendado", dbStatus: "agendado", origin: "crm", notes: null, bookedBy: "Cati", paid: false, firstVisit: true,
  anyPro: false, fitIn: false, outsideHours: false, confirmedVia: null, cancelReason: null, professionalColor: null, ...over,
});
function Harness({ it: i, nowMs, catalog = CATALOG, onClose = () => {} }: { it: AgendaItem; nowMs: number; catalog?: AgendaCatalog; onClose?: () => void }) {
  const actions = useAgendaActions(nowMs);
  return <AgendaSheetsProvider catalog={catalog}><EntrySheet item={i} onClose={onClose} actions={actions} nowMs={nowMs} /></AgendaSheetsProvider>;
}
const NINE_30 = Date.UTC(2026, 9, 16, 12, 30);

it("o próximo passo em destaque: Chegou no dia; depois Iniciar; depois Finalizar", async () => {
  const { rerender } = render(<Harness it={item()} nowMs={NINE_30} />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Chegou" })); });
  expect(setAppointmentStatusAction).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", "chegou");
  rerender(<Harness it={item({ status: "chegou", dbStatus: "chegou" })} nowMs={NINE_30} />);
  expect(screen.getByRole("button", { name: "Iniciar" })).toBeTruthy();
  rerender(<Harness it={item({ status: "em_atendimento", dbStatus: "em_atendimento" })} nowMs={NINE_30} />);
  expect(screen.getByRole("button", { name: "Finalizar" })).toBeTruthy();
});

it("psico r68 #7: com o caixa no CRM, Finalizar não fecha a folha (o Receber fica à mão); sem caixa, fecha como antes", async () => {
  const onClose = vi.fn();
  render(<Harness it={item({ status: "em_atendimento", dbStatus: "em_atendimento" })} nowMs={NINE_30} catalog={{ ...CATALOG, canCaixa: true }} onClose={onClose} />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Finalizar" })); });
  expect(setAppointmentStatusAction).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", "compareceu");
  expect(onClose).not.toHaveBeenCalled();
});

it("Faltou só depois do horário; no modo consulta some o Remarcar e o Cancelar continua", () => {
  render(<Harness it={item()} nowMs={NINE_30} />);
  expect(screen.queryByRole("button", { name: "Faltou" })).toBeNull();
  expect(screen.getByRole("button", { name: "Remarcar" })).toBeTruthy();
  cleanup();
  render(<Harness it={item({ status: "conferir" })} nowMs={Date.UTC(2026, 9, 16, 13, 30)} catalog={{ ...CATALOG, agendaMode: "consulta" }} />);
  expect(screen.getByRole("button", { name: "Faltou" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Finalizar" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Remarcar" })).toBeNull();
  expect(screen.getByRole("button", { name: "Cancelar horário" })).toBeTruthy();
});

it("selos: primeira vez, encaixe e confirmado pelo link", () => {
  render(<Harness it={item({ fitIn: true, confirmedVia: "link", status: "confirmado", dbStatus: "confirmado" })} nowMs={NINE_30} />);
  for (const t of ["Primeira vez", "Encaixe", "Confirmou pelo link"]) expect(screen.getByText(t)).toBeTruthy();
});

it("com o caixa no CRM e a permissão, 'Abrir comanda' no horário; com comanda aberta, 'Ver comanda'", () => {
  render(<Harness it={item({ status: "compareceu", dbStatus: "compareceu" })} nowMs={NINE_30} catalog={{ ...CATALOG, canCaixa: true }} />);
  fireEvent.click(screen.getByRole("button", { name: "Receber na comanda" }));
  expect(openForAppointment).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
  cleanup();
  render(<Harness it={item({ openComandaId: "c9" })} nowMs={NINE_30} catalog={{ ...CATALOG, canCaixa: true }} />);
  expect(screen.getByRole("button", { name: "Ver comanda" })).toBeTruthy();
  cleanup();
  render(<Harness it={item({})} nowMs={NINE_30} catalog={{ ...CATALOG, canCaixa: false }} />);
  expect(screen.queryByRole("button", { name: "Abrir comanda" })).toBeNull();
});

it("item 5 (17/10): a folha do horário mostra a visita inteira (todas as profissionais), com a assistente, o total e Chegou para a visita toda", async () => {
  const { dayVisitAction } = await import("@/app/(app)/agenda/actions");
  const svc = (id: string, service: string, pro: string, assistant: string | null, status: string, priceCents: number | null) =>
    ({ appointmentId: id, serviceId: null, service, professionalId: "p", pro, assistant, start: at(9), end: at(10), status, priceCents });
  vi.mocked(dayVisitAction).mockResolvedValueOnce({ ok: true, data: { canMark: true, agendaMode: "dupla", visit: {
    key: "k", visitId: "v1", contactId: "c1", dealId: null, name: "Cristiana Souza", day: "2026-10-16", entry: at(9), comanda: null, values: true, cancelled: [],
    services: [svc("a1", "Luzes e Mechas", "Thaise", null, "confirmado", 58000), svc("a2", "Coloração", "Thaise", "Sidney", "agendado", 18000),
      svc("a3", "Manicure", "Ana", null, "agendado", null), svc("a4", "Escova", "Jamille", null, "agendado", 9000)],
  } } } as never);
  render(<Harness it={item({ appointmentId: "a1", scheduledAt: at(9) })} nowMs={new Date(at(8)).getTime()} />);
  const visita = await screen.findByRole("region", { name: "Visita de Cristiana Souza" });
  expect(screen.getAllByTestId("visita-servico")).toHaveLength(4);
  expect(visita.textContent).toContain("assistente: Sidney");
  expect(visita.textContent).toContain("Total(1 sem preço)R$");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Chegou (a visita toda)" })); });
  expect(setAppointmentStatusAction).toHaveBeenCalledWith("a1", "chegou");
});

it("Fase C (item 19): mostra o marcador e o tipo do horário, e quem pode troca os dois", async () => {
  const catalog = { ...CATALOG, labels: [{ id: "l-obs", name: "VER OBS", color: "#9a3b3b" }, { id: "l-nc", name: "Não Cobrar", color: null }], visitTypes: [{ value: "indicacao" as const, label: "Indicada" }, { value: "noiva" as const, label: "Noiva" }] };
  render(<Harness it={item({ label: { id: "l-obs", name: "VER OBS", color: "#9a3b3b" }, visitType: "noiva", visitTypeLabel: "Noiva" })} nowMs={NINE_30} catalog={catalog} />);
  expect(screen.getAllByText("Ver Obs").length).toBeGreaterThan(0); // o selo e a escolha
  expect(screen.getByRole("radio", { name: "Ver Obs" }).getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("radio", { name: "Noiva" }).getAttribute("aria-checked")).toBe("true");
  await act(async () => { fireEvent.click(screen.getByRole("radio", { name: "Não Cobrar" })); });
  expect(setAppointmentLabelAction).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", "l-nc");
  await act(async () => { fireEvent.click(screen.getByRole("radio", { name: "Indicada" })); });
  expect(setVisitTypeAction).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", "indicacao");
});

it("sem opções no catálogo (função desligada ou sem agenda.marcador) a folha não oferece trocar, mas o marcador já gravado continua aparecendo", () => {
  render(<Harness it={item({ label: { id: "l-obs", name: "VER OBS", color: null }, visitType: "noiva", visitTypeLabel: "Noiva" })} nowMs={NINE_30} />);
  expect(screen.getByText("Ver Obs")).toBeTruthy();
  expect(screen.getByText("Noiva")).toBeTruthy();
  expect(screen.queryByRole("radio", { name: "Nenhum" })).toBeNull();
});

it("item 20: o aviso da cliente salta ao abrir o horário (uma vez); noHorario desligado ou função desligada não salta", async () => {
  try { sessionStorage.clear(); } catch { /* sem armazenamento */ }
  const com = { ...CATALOG, clientAlert: { on: true, text: "Sem foto, por favor" } };
  const { unmount } = render(<Harness it={item({ alertNotes: "Alérgica a amônia", imageUse: "nao" })} nowMs={NINE_30} catalog={com} />);
  const d = screen.getByRole("dialog", { name: "Aviso da cliente" });
  expect(d.textContent).toContain("Alérgica a amônia");
  expect(d.textContent).toContain("Sem foto, por favor");
  fireEvent.click(screen.getByRole("button", { name: "Entendi" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Aviso da cliente" })).toBeNull());
  unmount();
  render(<Harness it={item({ alertNotes: "Alérgica a amônia", imageUse: "nao" })} nowMs={NINE_30} catalog={com} />);
  expect(screen.queryByRole("dialog", { name: "Aviso da cliente" })).toBeNull();
  cleanup();
  render(<Harness it={item({ key: "ag:2", visitId: "v2", alertNotes: "Outro aviso" })} nowMs={NINE_30} catalog={{ ...CATALOG, clientAlert: { on: false, text: "x" } }} />);
  expect(screen.queryByRole("dialog", { name: "Aviso da cliente" })).toBeNull();
  cleanup();
  render(<Harness it={item({ key: "ag:3", visitId: "v3", alertNotes: "Outro aviso" })} nowMs={NINE_30} />);
  expect(screen.queryByRole("dialog", { name: "Aviso da cliente" })).toBeNull();
});

it("horário que se repete mostra 'Repete: 3 de 8'; avulso não mostra", () => {
  const { rerender } = render(<Harness it={item({ series: { index: 3, total: 8 } })} nowMs={NINE_30} />);
  expect(screen.getByText("Repete: 3 de 8")).toBeTruthy();
  rerender(<Harness it={item({ series: null })} nowMs={NINE_30} />);
  expect(screen.queryByText(/^Repete:/)).toBeNull();
});

it("r66 #2: a ação principal vem antes de tudo; Tipo e Marcador ficam em 'Mais detalhes'; 'Desfazer' é discreto; marcador em maiúsculas vira Título", () => {
  const cat = { ...CATALOG, canCaixa: true, labels: [{ id: "l1", name: "CLIENTE DOENTE - VAI REMARCAR", color: null }], visitTypes: [{ value: "noiva" as const, label: "Noiva" }] } as AgendaCatalog;
  render(<Harness it={item({ status: "compareceu", dbStatus: "compareceu", openComandaId: "c9" })} nowMs={NINE_30} catalog={cat} />);
  const principal = screen.getByTestId("acao-principal");
  expect(principal.querySelector("button")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Receber na comanda" }).className).toContain("h-12");
  expect(principal.contains(screen.getByRole("button", { name: "Receber na comanda" }))).toBe(true);
  const mais = screen.getByText("Mais detalhes").closest("details")!;
  expect(mais.open).toBe(false);
  expect(mais.contains(screen.getByTestId("marcador-e-tipo"))).toBe(true);
  expect(mais.textContent).toContain("Cliente Doente - Vai Remarcar");
  expect(mais.textContent).not.toContain("CLIENTE DOENTE");
  const desfazer = screen.getByRole("button", { name: /Desfazer/ });
  expect(desfazer.className).toContain("text-xs");
  expect(principal.contains(desfazer)).toBe(false);
});
