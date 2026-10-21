// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const freeSlotsAction = vi.fn();
const createVisitAction = vi.fn();
const searchClientsAction = vi.fn();
const rescheduleAction = vi.fn();
const createRecurringVisitsAction = vi.fn();
const auxPreviewAction = vi.fn(async () => ({ ok: true, data: [] }));
vi.mock("@/app/(app)/agenda/actions", () => ({
  auxPreviewAction: (...a: unknown[]) => auxPreviewAction(...(a as [])),
  createRecurringVisitsAction: (...a: unknown[]) => createRecurringVisitsAction(...a),
  peopleOnNumberAction: vi.fn(async () => ({ ok: true, data: [] })),
  freeSlotsAction: (...a: unknown[]) => freeSlotsAction(...a), createVisitAction: (...a: unknown[]) => createVisitAction(...a),
  searchClientsAction: (...a: unknown[]) => searchClientsAction(...a), rescheduleAction: (...a: unknown[]) => rescheduleAction(...a), resolveWaitlistAction: vi.fn(),
}));
import { BookingSheet } from "./booking-sheet";

beforeAll(() => {
  // jsdom não tem matchMedia (a folha escolhe lateral × de baixo)
  window.matchMedia ??= ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const SERVICES = [{ id: "s-corte", label: "Corte", durationMin: 60 }, { id: "s-mechas", label: "Mechas", durationMin: null }];
const PROS = [{ id: "p-ana", name: "Ana", active: true, serviceIds: ["s-corte", "s-mechas"] }, { id: "p-bia", name: "Bia", active: true, serviceIds: ["s-corte"] }];
const livre = {
  serviceLabel: "Corte", durationMin: 60, needsDuration: false, nobody: false, preview: { state: "livre", text: "Livre", warnings: [], professionalId: "p-ana" },
  suggestions: [{ professionalId: "p-ana", name: "Ana", startsAt: ["2026-10-16T13:00:00.000Z", "2026-10-16T13:30:00.000Z"] }],
};
const encaixe = { ...livre, preview: { state: "encaixe", text: "Ana já tem Paula das 10:00 às 11:00", warnings: [], professionalId: "p-ana" } };
const PAULA = { contactId: "c-paula", name: "Paula Souza" };
/** Observação, marcador, tipo e repetir ficam em "Mais opções", recolhidas (20/10). */
const maisOpcoes = () => fireEvent.click(screen.getByRole("button", { name: /Mais opções/ }));
const props = (over: Record<string, unknown> = {}) => ({
  open: true, onClose: () => {}, services: SERVICES, professionals: PROS, canFitIn: true, canEditConfig: false, agendaMode: "so_crm" as const,
  initial: { day: "2026-10-16", time: "10:00", professionalId: "p-ana" }, onDone: vi.fn(), ...over,
});

it("marca: busca a cliente, escolhe o serviço, vê 'Livre' e manda a visita com a request key (hora lida em Salvador)", async () => {
  searchClientsAction.mockResolvedValue({ ok: true, data: [{ id: "c-paula", name: "Paula Souza", phone: "+5571988000101", lastVisit: "2026-08-12", ignored: false }] });
  freeSlotsAction.mockResolvedValue({ ok: true, data: livre });
  createVisitAction.mockResolvedValue({ ok: true, data: { visitId: "v1", appointmentIds: ["a1"], day: "2026-10-16", reused: false } });
  const p = props();
  render(<BookingSheet {...p} />);
  fireEvent.change(screen.getByLabelText("Buscar cliente por nome ou telefone"), { target: { value: "pau" } });
  fireEvent.click(await screen.findByRole("button", { name: /Paula Souza/ }));
  fireEvent.change(screen.getByLabelText("Serviço 1"), { target: { value: "s-corte" } });
  expect(await screen.findByText("Livre")).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: "Ela quer a Ana" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Marcar" })); });
  expect(createVisitAction).toHaveBeenCalledWith(expect.objectContaining({
    client: { contactId: "c-paula" }, startsAt: "2026-10-16T13:00:00.000Z", fitIn: false, requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    items: [expect.objectContaining({ serviceId: "s-corte", professionalId: "p-ana", preference: "escolhida" })],
  }));
  expect(p.onDone).toHaveBeenCalledWith({ day: "2026-10-16", message: expect.stringContaining("Horário marcado: Paula"), confirm: expect.stringMatching(/^Marcado: .*às 10:00, Corte com Ana\.$/) });
});

it("conflito: o botão principal é 'Escolher outro horário'; 'Encaixar mesmo assim' é secundário, pede o motivo e manda fitIn", async () => {
  freeSlotsAction.mockResolvedValue({ ok: true, data: encaixe });
  createVisitAction.mockResolvedValue({ ok: true, data: { visitId: "v1", appointmentIds: ["a1"], day: "2026-10-16", reused: false } });
  render(<BookingSheet {...props({ initial: { day: "2026-10-16", time: "10:30", professionalId: "p-ana", serviceId: "s-corte", client: PAULA } })} />);
  expect(await screen.findByText("Ana já tem Paula das 10:00 às 11:00")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Escolher outro horário" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Marcar" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Encaixar mesmo assim" }));
  const go = screen.getByRole("button", { name: "Encaixar mesmo assim" }) as HTMLButtonElement;
  expect(go.disabled).toBe(true); // sem motivo não encaixa
  fireEvent.change(screen.getByLabelText("Por que vai encaixar por cima de outra cliente?"), { target: { value: "Cliente antiga, pediu urgência" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Encaixar mesmo assim" })); });
  expect(createVisitAction).toHaveBeenCalledWith(expect.objectContaining({ fitIn: true, notes: "Encaixe: Cliente antiga, pediu urgência" }));
});

it("sem a permissão de encaixe: nada de 'Encaixar mesmo assim'; só 'Escolher outro horário'", async () => {
  freeSlotsAction.mockResolvedValue({ ok: true, data: encaixe });
  render(<BookingSheet {...props({ canFitIn: false, initial: { day: "2026-10-16", time: "10:30", professionalId: "p-ana", serviceId: "s-corte", client: PAULA } })} />);
  await screen.findByText("Ana já tem Paula das 10:00 às 11:00");
  expect(screen.queryByRole("button", { name: "Encaixar mesmo assim" })).toBeNull();
  expect(screen.getByRole("button", { name: "Escolher outro horário" })).toBeTruthy();
});

it("psico r68 #12/#14: escolher a profissional já vale 'Ela quer a X' (Qualquer uma = Tanto faz); a hora não vem preenchida", async () => {
  freeSlotsAction.mockResolvedValue({ ok: true, data: livre });
  createVisitAction.mockResolvedValue({ ok: true, data: { visitId: "v1", appointmentIds: ["a1"], day: "2026-10-16", reused: false } });
  render(<BookingSheet {...props({ initial: { day: "2026-10-16", time: "", professionalId: "", serviceId: "s-corte", client: PAULA } })} />);
  expect((screen.getByLabelText("Hora") as HTMLInputElement).value).toBe("");
  expect(screen.getByRole("radio", { name: "Tanto faz quem atende" }).getAttribute("aria-checked")).toBe("true");
  fireEvent.change(screen.getByLabelText("Profissional 1"), { target: { value: "p-bia" } });
  expect(screen.getByRole("radio", { name: "Ela quer a Bia" }).getAttribute("aria-checked")).toBe("true");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Marcar" })); });
  expect(screen.getByRole("alert").textContent).toContain("Escolha a hora");
  fireEvent.change(screen.getByLabelText("Hora"), { target: { value: "10:00" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Marcar" })); });
  expect(createVisitAction).toHaveBeenCalledWith(expect.objectContaining({ items: [expect.objectContaining({ professionalId: "p-bia", preference: "escolhida" })] }));
});

it("serviço sem duração pede 'Quanto tempo leva desta vez?'; só quem edita Configurações vê 'Salvar como duração do serviço'", () => {
  freeSlotsAction.mockResolvedValue({ ok: true, data: { ...livre, serviceLabel: "Mechas", durationMin: null, needsDuration: true, preview: null, suggestions: [] } });
  const initial = { day: "2026-10-16", time: "10:00", professionalId: "p-ana", serviceId: "s-mechas" };
  const { rerender } = render(<BookingSheet {...props({ initial })} />);
  expect(screen.getByLabelText("Quanto tempo leva desta vez? (min)")).toBeTruthy();
  expect(screen.queryByLabelText("Salvar como duração do serviço")).toBeNull();
  rerender(<BookingSheet {...props({ initial, canEditConfig: true })} />);
  expect(screen.getByLabelText("Salvar como duração do serviço")).toBeTruthy();
});

it("modo dupla: lembra de marcar também no Avec", () => {
  freeSlotsAction.mockResolvedValue({ ok: true, data: livre });
  render(<BookingSheet {...props({ agendaMode: "dupla" })} />);
  expect(screen.getByRole("note").textContent).toBe("Enquanto o Avec estiver ligado, marque, remarque e cancele também lá.");
});

it("o mesmo horário que já veio do Avec: mostra o texto e 'Abrir o horário'", async () => {
  freeSlotsAction.mockResolvedValue({ ok: true, data: livre });
  createVisitAction.mockResolvedValue({ ok: false, error: "Paula já tem Corte às 10:00 (veio do Avec). Abrir o horário", openAppointment: { id: "a-avec", day: "2026-10-16" } });
  render(<BookingSheet {...props({ initial: { day: "2026-10-16", time: "10:00", professionalId: "p-ana", serviceId: "s-corte", client: PAULA } })} />);
  fireEvent.click(screen.getByRole("radio", { name: "Ela quer a Ana" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Marcar" })); });
  expect(screen.getByRole("alert").textContent).toContain("veio do Avec");
  expect(screen.getByRole("link", { name: "Abrir o horário" }).getAttribute("href")).toBe("/agenda?d=2026-10-16&destaque=a-avec");
});

it("'Tanto faz' manda sem_preferencia; remarcar para outra quando ela pediu a Ana pede confirmação", async () => {
  freeSlotsAction.mockResolvedValue({ ok: true, data: livre });
  createVisitAction.mockResolvedValue({ ok: true, data: { visitId: "v1", appointmentIds: ["a1"], day: "2026-10-16", reused: false } });
  render(<BookingSheet {...props({ initial: { day: "2026-10-16", time: "10:00", professionalId: "", serviceId: "s-corte", client: PAULA } })} />);
  fireEvent.click(screen.getByRole("radio", { name: "Tanto faz quem atende" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Marcar" })); });
  expect(createVisitAction).toHaveBeenCalledWith(expect.objectContaining({ items: [expect.objectContaining({ professionalId: null, preference: "sem_preferencia" })] }));
  cleanup();

  rescheduleAction.mockResolvedValue({ ok: true, data: { day: "2026-10-16", previousDay: "2026-10-16" } });
  const reschedule = { appointmentId: "a1", serviceId: "s-corte", serviceLabel: "Corte", professionalId: "p-ana", professionalName: "Ana", durationMin: 60, clientName: "Paula Souza", contactId: "c-paula", preference: "escolhida" as const };
  render(<BookingSheet {...props({ reschedule })} />);
  fireEvent.change(screen.getByLabelText("Profissional 1"), { target: { value: "p-bia" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Remarcar" })); });
  expect(screen.getByRole("alert").textContent).toBe("Ela pediu a Ana. Marque \"Trocar mesmo assim\" para trocar.");
  fireEvent.click(screen.getByLabelText("Ela pediu a Ana. Trocar mesmo assim"));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Remarcar" })); });
  expect(rescheduleAction).toHaveBeenCalledWith("a1", expect.objectContaining({ professionalId: "p-bia", confirmProChange: true }));
});

it("aberta pela sugestão da IA: cliente, serviço, profissional, dia e hora já preenchidos; só marca no botão Marcar", async () => {
  freeSlotsAction.mockResolvedValue({ ok: true, data: livre });
  createVisitAction.mockResolvedValue({ ok: true, data: { visitId: "v1", appointmentIds: ["a1"], day: "2026-10-20", reused: false } });
  const p = props({ agendaMode: "dupla", initial: { day: "2026-10-20", time: "15:00", professionalId: "p-ana", serviceId: "s-corte", client: PAULA, dealId: "d1" } });
  render(<BookingSheet {...p} />);
  expect((screen.getByLabelText("Serviço 1") as HTMLSelectElement).value).toBe("s-corte");
  expect((screen.getByLabelText("Profissional 1") as HTMLSelectElement).value).toBe("p-ana");
  expect((screen.getByLabelText("Dia") as HTMLInputElement).value).toBe("2026-10-20");
  expect((screen.getByLabelText("Hora") as HTMLInputElement).value).toBe("15:00");
  expect(screen.getByText(/Paula Souza/)).toBeTruthy();
  // O aviso do modo dupla (marcar também no Avec) continua.
  expect(screen.getByRole("note").textContent).toMatch(/Avec/);
  await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
  expect(createVisitAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("radio", { name: "Tanto faz quem atende" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Marcar" })); });
  expect(createVisitAction).toHaveBeenCalledTimes(1);
  expect(createVisitAction.mock.calls[0][0]).toMatchObject({ startsAt: "2026-10-20T18:00:00.000Z", dealId: "d1", client: { contactId: "c-paula" }, items: [{ serviceId: "s-corte", professionalId: "p-ana" }] });
  expect(p.onDone).toHaveBeenCalled();
});

it("aberta pela coluna de uma profissional: 'Ela quer a Ana' já vem marcado (dá para trocar para Tanto faz)", async () => {
  freeSlotsAction.mockResolvedValue({ ok: true, data: livre });
  createVisitAction.mockResolvedValue({ ok: true, data: { visitId: "v1", appointmentIds: ["a1"], day: "2026-10-16", reused: false } });
  render(<BookingSheet {...props({ initial: { day: "2026-10-16", time: "10:00", professionalId: "p-ana", preference: "escolhida", serviceId: "s-corte", client: PAULA } })} />);
  expect(screen.getByRole("radio", { name: "Ela quer a Ana" }).getAttribute("aria-checked")).toBe("true");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Marcar" })); });
  expect(createVisitAction).toHaveBeenCalledWith(expect.objectContaining({ items: [expect.objectContaining({ professionalId: "p-ana", preference: "escolhida" })] }));
});

const LABELS = [{ id: "l-obs", name: "VER OBS", color: "#9a3b3b" }, { id: "l-nc", name: "Não Cobrar", color: null }];
const TYPES = [{ value: "indicacao" as const, label: "Indicação" }, { value: "noiva" as const, label: "Noiva" }];

it("Tipo e Marcador são opcionais e vão no pedido", async () => {
  freeSlotsAction.mockResolvedValue({ ok: true, data: livre });
  createVisitAction.mockResolvedValue({ ok: true, data: { visitId: "v1", appointmentIds: ["a1"], day: "2026-10-16", reused: false } });
  render(<BookingSheet {...props({ labels: LABELS, visitTypes: TYPES, initial: { day: "2026-10-16", time: "10:00", professionalId: "p-ana", serviceId: "s-corte", client: PAULA } })} />);
  fireEvent.click(screen.getByRole("radio", { name: "Ela quer a Ana" }));
  maisOpcoes();
  fireEvent.click(screen.getByRole("radio", { name: "Noiva" }));
  fireEvent.click(screen.getByRole("radio", { name: "Ver Obs" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Marcar" })); });
  expect(createVisitAction).toHaveBeenCalledWith(expect.objectContaining({ visitType: "noiva", labelId: "l-obs" }));
});

it("sem escolher nada, manda os dois vazios; 'Nenhum' tira a escolha", async () => {
  freeSlotsAction.mockResolvedValue({ ok: true, data: livre });
  createVisitAction.mockResolvedValue({ ok: true, data: { visitId: "v1", appointmentIds: ["a1"], day: "2026-10-16", reused: false } });
  render(<BookingSheet {...props({ labels: LABELS, visitTypes: TYPES, initial: { day: "2026-10-16", time: "10:00", professionalId: "p-ana", serviceId: "s-corte", client: PAULA } })} />);
  fireEvent.click(screen.getByRole("radio", { name: "Tanto faz quem atende" }));
  maisOpcoes();
  fireEvent.click(screen.getByRole("radio", { name: "Indicação" }));
  fireEvent.click(screen.getAllByRole("radio", { name: "Nenhum" })[0]); // a linha Tipo
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Marcar" })); });
  expect(createVisitAction).toHaveBeenCalledWith(expect.objectContaining({ visitType: null, labelId: null }));
});

it("sem opções (função desligada ou sem permissão) as linhas Tipo e Marcador nem aparecem", () => {
  render(<BookingSheet {...props()} />);
  maisOpcoes();
  expect(screen.queryByTestId("marcador-e-tipo")).toBeNull();
  cleanup();
  render(<BookingSheet {...props({ labels: LABELS, visitTypes: [] })} />);
  maisOpcoes();
  expect(screen.queryByText("Tipo")).toBeNull();
  expect(screen.getByText("Marcador")).toBeTruthy();
});

describe("Repetir (item 23a)", () => {
  const REPEAT = { maxSemanas: 12, maxVezes: 26 };
  const base = { day: "2026-10-15", time: "10:00", professionalId: "p-ana", serviceId: "s-corte", client: PAULA };

  it("a chave 'Repetir' abre 'A cada [1–12] semanas' e '[2–26] vezes' e manda o pedido repetido; o que não coube aparece na folha", async () => {
    freeSlotsAction.mockResolvedValue({ ok: true, data: livre });
    createRecurringVisitsAction.mockResolvedValue({ ok: true, data: { seriesId: "s1", created: [{ day: "2026-10-15", visitId: "v1" }, { day: "2026-10-29", visitId: "v2" }, { day: "2026-11-26", visitId: "v3" }],
      skipped: [{ day: "2026-11-12", reason: "Ana está com a agenda bloqueada nesse horário (Curso)." }] } });
    const p = props({ repeat: REPEAT, initial: base });
    render(<BookingSheet {...p} />);
    expect(screen.queryByLabelText("A cada quantas semanas")).toBeNull();
    maisOpcoes();
    fireEvent.click(screen.getByRole("switch", { name: "Repetir" }));
    const semanas = screen.getByLabelText("A cada quantas semanas") as HTMLSelectElement;
    const vezes = screen.getByLabelText("Quantas vezes") as HTMLSelectElement;
    expect([...semanas.options].map((o) => o.value)).toEqual(Array.from({ length: 12 }, (_, k) => String(k + 1)));
    expect([...vezes.options].map((o) => o.value)).toEqual(Array.from({ length: 25 }, (_, k) => String(k + 2)));
    fireEvent.change(semanas, { target: { value: "2" } });
    fireEvent.change(vezes, { target: { value: "4" } });
    fireEvent.click(screen.getByRole("radio", { name: "Ela quer a Ana" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Marcar" })); });
    expect(createVisitAction).not.toHaveBeenCalled();
    expect(createRecurringVisitsAction).toHaveBeenCalledWith(expect.objectContaining({ client: { contactId: "c-paula" }, startsAt: "2026-10-15T13:00:00.000Z", repeat: { everyWeeks: 2, times: 4 } }));
    expect(screen.getByTestId("repeat-result").textContent).toBe("3 marcados. 1 não coube: 12/11 (Ana está com a agenda bloqueada nesse horário (Curso))");
    expect(p.onDone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Pronto" }));
    expect(p.onDone).toHaveBeenCalledWith({ day: "2026-10-15", message: "3 marcados. 1 não coube." });
  });

  it("tudo coube: fecha com '4 marcados' e a frequência", async () => {
    freeSlotsAction.mockResolvedValue({ ok: true, data: livre });
    createRecurringVisitsAction.mockResolvedValue({ ok: true, data: { seriesId: "s1", created: ["2026-10-15", "2026-10-22", "2026-10-29", "2026-11-05"].map((day) => ({ day, visitId: day })), skipped: [] } });
    const p = props({ repeat: REPEAT, initial: base });
    render(<BookingSheet {...p} />);
    maisOpcoes();
    fireEvent.click(screen.getByRole("switch", { name: "Repetir" }));
    fireEvent.change(screen.getByLabelText("Quantas vezes"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("radio", { name: "Ela quer a Ana" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Marcar" })); });
    expect(createRecurringVisitsAction).toHaveBeenCalledWith(expect.objectContaining({ repeat: { everyWeeks: 1, times: 4 } }));
    expect(p.onDone).toHaveBeenCalledWith({ day: "2026-10-15", message: "4 marcados: Paula, toda semana" });
  });

  it("sem a função ou a permissão (repeat vazio), no Remarcar e na lista de espera a chave Repetir não aparece", () => {
    const { unmount } = render(<BookingSheet {...props({ initial: base })} />);
    expect(screen.queryByRole("switch", { name: "Repetir" })).toBeNull();
    unmount();
    const r = render(<BookingSheet {...props({ repeat: REPEAT, initial: base, reschedule: { appointmentId: "a1", serviceId: "s-corte", serviceLabel: "Corte", professionalId: "p-ana", durationMin: 60, clientName: "Paula Souza", contactId: "c-paula" } })} />);
    expect(screen.queryByRole("switch", { name: "Repetir" })).toBeNull();
    r.unmount();
    render(<BookingSheet {...props({ repeat: REPEAT, initial: { ...base, waitlistId: "w1" } })} />);
    expect(screen.queryByRole("switch", { name: "Repetir" })).toBeNull();
  });
});

describe("auxiliares, duração, preço e resumo (20/10)", () => {
  const PROS_AUX = [...PROS,
    { id: "p-sid", name: "Sidney", active: true, serviceIds: [], assistantOf: "p-ana" },
    { id: "p-rob", name: "Roberta", active: true, serviceIds: [], assistantOf: "p-ana" },
    { id: "p-car", name: "Carla", active: true, serviceIds: ["s-corte"] },
  ];
  const SERV_PRECO = [{ id: "s-corte", label: "Corte", durationMin: 60, priceCents: 12000 }, { id: "s-mechas", label: "Mechas", durationMin: null, priceCents: 28000 }];
  const base = { day: "2026-10-16", time: "10:00", professionalId: "p-ana", serviceId: "s-corte", client: PAULA, preference: "escolhida" as const };
  const ok = { ok: true, data: { visitId: "v1", appointmentIds: ["a1"], day: "2026-10-16", reused: false } };
  /** O R$ do Intl vem com espaço fixo (U+00A0). */
  const sp = (t: string | null) => (t ?? "").replace(/\u00a0/g, " ");

  it("as fixas da principal vêm primeiro num toque; '+ Outra auxiliar' busca por nome; a visita vai com as auxiliares na ordem", async () => {
    freeSlotsAction.mockResolvedValue({ ok: true, data: livre });
    createVisitAction.mockResolvedValue(ok);
    render(<BookingSheet {...props({ professionals: PROS_AUX, initial: base })} />);
    expect(screen.getByText("Fixas da Ana:")).toBeTruthy();
    // a principal nunca é oferecida; as fixas da Ana sim
    expect(screen.queryByRole("button", { name: "Pôr Ana de auxiliar" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Pôr Sidney de auxiliar" }));
    expect(screen.getByRole("list", { name: "Auxiliares do serviço 1" }).textContent).toContain("Sidney");
    fireEvent.click(screen.getByRole("button", { name: "+ Outra auxiliar" }));
    fireEvent.change(screen.getByLabelText("Buscar auxiliar do serviço 1"), { target: { value: "car" } });
    fireEvent.click(screen.getByRole("button", { name: "Carla" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Marcar" })); });
    expect(createVisitAction).toHaveBeenCalledWith(expect.objectContaining({ items: [expect.objectContaining({ serviceId: "s-corte", professionalId: "p-ana", assistantIds: ["p-sid", "p-car"] })] }));
  });

  it("tirar a auxiliar e trocar a principal: quem virou principal sai das auxiliares e as fixas mudam", () => {
    freeSlotsAction.mockResolvedValue({ ok: true, data: livre });
    render(<BookingSheet {...props({ professionals: PROS_AUX, initial: base })} />);
    fireEvent.click(screen.getByRole("button", { name: "Pôr Sidney de auxiliar" }));
    fireEvent.click(screen.getByRole("button", { name: "Tirar Sidney das auxiliares" }));
    expect(screen.queryByRole("list", { name: "Auxiliares do serviço 1" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "+ Outra auxiliar" }));
    fireEvent.change(screen.getByLabelText("Buscar auxiliar do serviço 1"), { target: { value: "bia" } });
    fireEvent.click(screen.getByRole("button", { name: "Bia" }));
    fireEvent.change(screen.getByLabelText("Profissional 1"), { target: { value: "p-bia" } });
    expect(screen.queryByRole("list", { name: "Auxiliares do serviço 1" })).toBeNull();
    expect(screen.queryByText("Fixas da Ana:")).toBeNull();
  });

  it("a agenda da auxiliar aparece antes de marcar; passar do limite da comanda avisa quem fica só na agenda", async () => {
    freeSlotsAction.mockResolvedValue({ ok: true, data: livre });
    auxPreviewAction.mockResolvedValue({ ok: true, data: [{ professionalId: "p-sid", name: "Sidney", state: "encaixe", text: "A auxiliar Sidney não está livre: Sidney já tem Maria das 10:00 às 11:00." }] } as never);
    render(<BookingSheet {...props({ professionals: PROS_AUX, initial: base, comandaAssistantsMax: 1 })} />);
    fireEvent.click(screen.getByRole("button", { name: "Pôr Sidney de auxiliar" }));
    fireEvent.click(screen.getByRole("button", { name: "Pôr Roberta de auxiliar" }));
    expect(await screen.findByText("A auxiliar Sidney não está livre: Sidney já tem Maria das 10:00 às 11:00.")).toBeTruthy();
    expect(auxPreviewAction).toHaveBeenLastCalledWith(expect.objectContaining({ assistantIds: ["p-sid", "p-rob"], startsAt: "2026-10-16T13:00:00.000Z", durationMin: 60, serviceId: "s-corte" }));
    expect(screen.getByText("A comanda aceita até 1 assistente por serviço: Roberta fica só na agenda.")).toBeTruthy();
    // a auxiliar ocupada pede outro horário ou o encaixe, como a principal
    expect(screen.getByRole("button", { name: "Escolher outro horário" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Encaixar mesmo assim" })).toBeTruthy();
  });

  it("duração: vem a de quem atende e dá para mudar desta vez; 'Guardar como padrão da Ana' só para quem edita Configurações", async () => {
    freeSlotsAction.mockResolvedValue({ ok: true, data: livre });
    createVisitAction.mockResolvedValue(ok);
    const ANA_45 = PROS_AUX.map((p) => (p.id === "p-ana" ? { ...p, terms: { "s-corte": { durationMin: 45, priceCents: 15000 } } } : p));
    const { rerender } = render(<BookingSheet {...props({ professionals: ANA_45, services: SERV_PRECO, initial: base, perProTerms: true })} />);
    const dur = screen.getByLabelText("Duração (min)") as HTMLInputElement;
    expect(dur.value).toBe("45");
    expect(sp(screen.getByLabelText("Preço do serviço 1").textContent)).toBe("R$ 150");
    fireEvent.change(dur, { target: { value: "90" } });
    expect(screen.getByText("padrão 45 min")).toBeTruthy();
    expect(screen.queryByLabelText("Guardar como padrão da Ana")).toBeNull();
    rerender(<BookingSheet {...props({ professionals: ANA_45, services: SERV_PRECO, initial: base, perProTerms: true, canEditConfig: true })} />);
    fireEvent.click(screen.getByLabelText("Guardar como padrão da Ana"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Marcar" })); });
    expect(createVisitAction).toHaveBeenCalledWith(expect.objectContaining({ items: [expect.objectContaining({ durationMin: 90, saveDuration: true })] }));
  });

  it("o rodapé resume antes de confirmar: serviço, quem atende, auxiliar, dia, início–fim e preço", () => {
    freeSlotsAction.mockResolvedValue({ ok: true, data: livre });
    render(<BookingSheet {...props({ professionals: PROS_AUX, services: SERV_PRECO, initial: { ...base, day: "2026-10-22", time: "14:00" } })} />);
    fireEvent.click(screen.getByRole("button", { name: "Pôr Sidney de auxiliar" }));
    expect(sp(screen.getByTestId("booking-summary").textContent)).toBe("Corte com Ana + auxiliar Sidney · qui 22/10 14:00–15:00 · R$ 120");
    fireEvent.click(screen.getByRole("button", { name: "+ Outro serviço na mesma visita" }));
    fireEvent.change(screen.getByLabelText("Serviço 2"), { target: { value: "s-mechas" } });
    fireEvent.change(screen.getByLabelText("Profissional 2"), { target: { value: "p-ana" } });
    fireEvent.change(screen.getByLabelText("Quanto tempo leva desta vez? (min)"), { target: { value: "120" } });
    expect(sp(screen.getByTestId("booking-summary").textContent)).toBe("Corte com Ana + auxiliar Sidney, Mechas com Ana · qui 22/10 14:00–17:00 · R$ 400");
  });

  it("Remarcar mostra as auxiliares do horário e manda a troca só quando muda", async () => {
    freeSlotsAction.mockResolvedValue({ ok: true, data: livre });
    rescheduleAction.mockResolvedValue({ ok: true, data: { day: "2026-10-16", previousDay: "2026-10-16" } });
    const reschedule = { appointmentId: "a1", serviceId: "s-corte", serviceLabel: "Corte", professionalId: "p-ana", professionalName: "Ana", durationMin: 60, clientName: "Paula Souza", contactId: "c-paula", assistantIds: ["p-sid"] };
    render(<BookingSheet {...props({ professionals: PROS_AUX, reschedule })} />);
    expect(screen.getByRole("list", { name: "Auxiliares do serviço 1" }).textContent).toContain("Sidney");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Remarcar" })); });
    expect(rescheduleAction.mock.calls[0][1]).not.toHaveProperty("assistantIds");
    fireEvent.click(screen.getByRole("button", { name: "Tirar Sidney das auxiliares" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Remarcar" })); });
    expect(rescheduleAction.mock.calls[1][1]).toMatchObject({ assistantIds: [] });
  });
});
