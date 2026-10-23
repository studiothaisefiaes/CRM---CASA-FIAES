// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { DayVisit, DayVisitService } from "@/lib/day-visit";
import type { TodayItem, TodayTask, TodayBirthday } from "@/server/queries/today";
import type { AlertItem } from "@/server/queries/alerts";
import type { TeamNow } from "@/server/queries/team-now";

vi.mock("@/app/(app)/agenda/actions", () => ({ setAppointmentStatusAction: vi.fn(), dayVisitAction: vi.fn(), cancelAction: vi.fn() }));
vi.mock("@/app/(app)/funil/actions", () => ({ completeTaskAction: vi.fn(), setAttendanceAction: vi.fn() }));
vi.mock("@/app/(app)/contatos/actions", () => ({ birthdayConversationAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/components/caixa/comanda-provider", () => ({ useComanda: () => null }));
vi.mock("@/components/queue/use-lead-actions", () => ({ attendanceToast: () => "" }));
import { AniversarioBloco, AvisosBloco, CombinadosBloco, DiaNaCasaBloco, EquipeBloco, EsperandoBloco, ParaVoceAgora, RetomarBloco } from "./hoje-resumo";

afterEach(cleanup);
const at = (hm: string) => new Date(`2026-10-17T${hm}:00-03:00`).toISOString();
const NOW = new Date(at("12:00")).getTime();

const conversa = (id: string, o: Partial<TodayItem> = {}): TodayItem => ({ id, contactId: `c-${id}`, ownerId: null, name: `Cliente ${id}`, phone: "+5571990000000", stageName: "Em conversa", stageKey: "atendimento", slaMinutes: 5, at: at("11:58"), extra: null, ...o });
const tarefa = (id: string, o: Partial<TodayTask> = {}): TodayTask => ({ id, title: `Combinado ${id}`, kind: "proxima_acao", dueAt: at("15:00"), overdue: false, dealId: `d-${id}`, contactId: `c-${id}`, name: `Cliente ${id}`, ...o });
const aviso = (id: string, o: Partial<AlertItem> = {}): AlertItem => ({ id, dealId: null, type: "x", severity: "info", level: 1, message: `Aviso ${id}`, createdAt: at("11:30"), read: false, resolved: false, contactName: null, phone: null, contactId: null, forMe: true, forGestao: false, resolvable: true, href: "/atendimento", ...o });
const aniver = (id: string, o: Partial<TodayBirthday> = {}): TodayBirthday => ({ contactId: id, dealId: null, name: `Aniversariante ${id}`, label: "17/10", today: true, loyal: true, hasAvatar: false, ...o });
let n = 0;
const s = (status: string, o: Partial<DayVisitService> = {}): DayVisitService => ({ appointmentId: `a${++n}`, serviceId: null, service: "Corte", professionalId: "p", pro: "Ana", assistant: null, start: at("09:00"), end: at("10:00"), status, priceCents: null, ...o });
const visita = (name: string, services: DayVisitService[], o: Partial<DayVisit> = {}): DayVisit => ({ key: name, visitId: name, contactId: name, dealId: null, name, day: "2026-10-17", entry: services[0].start, services, cancelled: [], comanda: null, values: false, ...o });
const bloco = (name: string) => screen.getByRole("region", { name });

it("Para você agora: só as conversas esperando VOCÊ, os seus combinados e os avisos não lidos; Atender próxima vai para a sua primeira", () => {
  render(<ParaVoceAgora waitingMine={[conversa("m1"), conversa("m2")]} waiting={[conversa("e1"), conversa("m1"), conversa("m2")]} tasks={[tarefa("1"), tarefa("2"), tarefa("3")]} alerts={[aviso("1"), aviso("2")]} />);
  const faixa = screen.getByTestId("para-voce");
  expect(faixa.textContent).toContain("2 conversas esperando você · 3 combinados para hoje · 2 avisos");
  expect(within(faixa).getByRole("link", { name: /Atender próxima/ }).getAttribute("href")).toBe("/atendimento?lead=m1");
});

it("Para você agora sem nada seu: diz que está tudo em dia e Atender próxima pega a primeira da equipe", () => {
  render(<ParaVoceAgora waitingMine={[]} waiting={[conversa("e1")]} tasks={[]} alerts={[]} />);
  const faixa = screen.getByTestId("para-voce");
  expect(faixa.textContent).toContain("Nada pendente para você");
  expect(within(faixa).getByRole("link", { name: /Atender próxima/ }).getAttribute("href")).toBe("/atendimento?lead=e1");
});

it("Meus combinados: até 3 na prévia, sem telefone cru; cobranças, comparecimentos e programadas viram linha só quando há algo", () => {
  const tasks = [tarefa("1", { title: "Responder +557190000002", name: "Olga Fictícia", phone: "+557190000002", overdue: true, dueAt: at("10:00") }), tarefa("2"), tarefa("3"), tarefa("4")];
  const { unmount } = render(<CombinadosBloco tasks={tasks} unassigned={null} dues={[]} attendance={[]} programadas={{ pending: [], total: 0 }} nowMs={NOW} />);
  const b = bloco("Meus combinados");
  expect(b.textContent).toContain("Responder Olga Fictícia");
  expect(b.textContent).not.toContain("5353");
  expect(b.textContent).toContain("hoje 10:00 · atrasado");
  expect(within(b).getAllByTestId("previa-linha")).toHaveLength(3);
  expect(b.textContent).not.toMatch(/Cobranças|Comparecimentos|programadas/);
  fireEvent.click(within(b).getByRole("button", { name: "Ver todos: Meus combinados" }));
  const painel = screen.getByRole("dialog", { name: "Meus combinados" });
  expect(painel.textContent).toContain("Responder Olga Fictícia");
  expect(painel.textContent).not.toContain("+557190000002");
  unmount();
  const due = conversa("x", { name: null, phone: "+557190000002", extra: "Cobrança" });
  const conf = { dealId: "d9", contactId: "c9", name: "Dora", phone: "+5571", hasAvatar: false, scheduledAt: at("09:00"), ownerName: null };
  render(<CombinadosBloco tasks={[]} unassigned={null} dues={[due]} attendance={[conf]} programadas={{ pending: [], total: 2 }} nowMs={NOW} />);
  const b2 = bloco("Meus combinados");
  expect(b2.textContent).toContain("Cobranças e recontatos");
  expect(b2.textContent).toContain("Comparecimentos para conferir");
  expect(b2.textContent).not.toContain("Mensagens programadas"); // nenhuma sai hoje
  fireEvent.click(within(b2).getByRole("button", { name: "Ver todos: Meus combinados" }));
  const p2 = screen.getByRole("dialog", { name: "Meus combinados" });
  expect(p2.textContent).toContain("Cliente com final 5353");
  expect(within(p2).getByRole("button", { name: "Veio: Dora" })).toBeTruthy();
});

it("Avisos para você: até 3, sem telefone cru; abre a lista inteira", () => {
  render(<AvisosBloco alerts={[aviso("1", { message: "Cancelou pelo link: +557190000002", phone: "+557190000002" }), aviso("2"), aviso("3"), aviso("4")]} nowMs={NOW} />);
  const b = bloco("Avisos para você");
  expect(within(b).getAllByTestId("previa-linha")).toHaveLength(3);
  expect(b.textContent).toContain("Cancelou pelo link: cliente com final 5353");
  fireEvent.click(within(b).getByRole("button", { name: "Ver todos: Avisos para você" }));
  expect(within(screen.getByRole("dialog", { name: "Avisos para você" })).getAllByRole("link")).toHaveLength(4);
});

it("Avisos para você: cada aviso da prévia abre com um toque (pedido do site vai direto aos Pedidos do site, QA r58 I-6)", () => {
  render(<AvisosBloco alerts={[aviso("1", { type: "pedido_online", message: "Paula pediu Corte em sexta, 16/10 às 10:00 pelo site. Confirme ou recuse na Agenda.", href: "/agenda?pedidos=site" })]} nowMs={NOW} />);
  const b = bloco("Avisos para você");
  const link = within(b).getByRole("link", { name: /Paula pediu Corte/ });
  expect(link.getAttribute("href")).toBe("/agenda?pedidos=site");
});

it("Aniversário hoje: até 3 com Parabéns; o painel tem todas e os próximos 7 dias", () => {
  render(<AniversarioBloco items={[aniver("1"), aniver("2"), aniver("3"), aniver("4"), aniver("5", { today: false, label: "sáb 18/10" })]} />);
  const b = bloco("Aniversário hoje");
  expect(within(b).getAllByTestId("previa-linha")).toHaveLength(3);
  expect(within(b).getAllByText("Parabéns")).toHaveLength(3);
  fireEvent.click(within(b).getByRole("button", { name: "Ver todos: Aniversário hoje" }));
  const painel = screen.getByRole("dialog", { name: "Aniversário hoje" });
  expect(within(painel).getAllByRole("button", { name: /Mandar parabéns para/ })).toHaveLength(4);
  expect(painel.textContent).toContain("sáb 18/10");
});

it("O dia na Casa: números (faltam pagar só com caixa), as 2 próximas chegadas e 'Ver o dia todo' abre a tabela", () => {
  const visits = [
    visita("Fabiana Otero", [s("confirmado", { start: at("10:00") })]),
    visita("Helaine Neves", [s("agendado", { start: at("13:00"), service: "Luzes e Mechas", pro: "Thaise" })]),
    visita("Beatriz Villa Nova", [s("confirmado", { start: at("13:00"), service: "Avaliação", pro: "Gilvan" })]),
    visita("Fabiana Esteves", [s("agendado", { start: at("16:00") })]),
    visita("Thamires Domingues", [s("chegou")]),
    visita("Suzana Melo", [s("compareceu")]),
    visita("Camilla Santos", [s("faltou")]),
  ];
  const { unmount } = render(<DiaNaCasaBloco visits={visits} nowMs={NOW} caixaOn={false} canMark agendaMode="dupla" />);
  const b = bloco("O dia na Casa");
  expect(b.textContent).toContain("7 clientes");
  const nums = within(b).getByTestId("dia-numeros");
  expect(nums.textContent).toBe("1na Casa4a chegar1finalizaram1não vieram");
  const prox = within(b).getAllByTestId("previa-linha");
  expect(prox.map((r) => r.textContent)).toEqual(["13:00 Helaine Neves · Luzes e Mechas com Thaise", "13:00 Beatriz Villa Nova · Avaliação com Gilvan"]);
  fireEvent.click(within(b).getByRole("button", { name: "Ver o dia todo: O dia na Casa" }));
  const painel = screen.getByRole("dialog", { name: "O dia na Casa" });
  expect(within(painel).getAllByTestId("dia-linha")).toHaveLength(7);
  unmount();
  render(<DiaNaCasaBloco visits={visits} nowMs={NOW} caixaOn canMark agendaMode="dupla" />);
  expect(within(bloco("O dia na Casa")).getByTestId("dia-numeros").textContent).toContain("1faltam pagar");
});

it("Esperando resposta (a equipe toda): até 2 na prévia; Para retomar junta os parados; Equipe agora resume quem responde", () => {
  render(<>
    <EsperandoBloco waiting={[conversa("1", { name: "Joana Matos" }), conversa("2", { name: "Helena Pereira" }), conversa("3")]} late={0} resp={{ n: 0, avg: 0, within: 0, goal: 120 }} />
    <RetomarBloco followups={[conversa("4", { stageName: "Orçamento sem resposta" }), conversa("5", { stageName: "Orçamento sem resposta" })]} stale={[{ stage: "Em conversa", stageKey: "atendimento", parados: 26 } as never]} />
    <EquipeBloco team={{ members: [{ id: "u1", name: "Cati", state: "respondendo", waiting: 0, mine: 3, lastReplyAt: null, lastReplyVia: null, receives: true }], unowned: { waiting: 1, total: 2 } } satisfies TeamNow} now={new Date(NOW)} />
  </>);
  const esp = bloco("Esperando resposta");
  expect(within(esp).getAllByTestId("previa-linha")).toHaveLength(2);
  expect(esp.textContent).toContain("Joana Matos");
  const ret = bloco("Para retomar");
  expect(ret.textContent).toContain("Conversas paradas26");
  expect(ret.textContent).toContain("Orçamento sem resposta2");
  expect(bloco("Equipe agora").textContent).toContain("Cati · Respondendo agora");
});
