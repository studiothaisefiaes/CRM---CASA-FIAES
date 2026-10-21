// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace() {}, push() {}, refresh() {} }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/atendimento" }));
vi.mock("./tags-editor", () => ({ TagsEditor: ({ tags }: { tags: { name: string }[] }) => <div data-testid="etiquetas">{tags.map((t) => t.name).join(",")}</div> }));
vi.mock("./how-known", () => ({ HowKnown: () => null }));
vi.mock("@/components/contacts/people-on-number", () => ({ PeopleOnNumber: () => null }));
vi.mock("./next-action", () => ({ NextAction: () => null }));
vi.mock("./client-link-button", () => ({ ClientLinkButton: () => null }));
vi.mock("./visit-actions", () => ({ VisitActions: () => null }));
vi.mock("./pause-switch", () => ({ PauseSwitch: ({ pausedUntil }: { pausedUntil: string | null }) => <div data-testid="pausa">{String(pausedUntil)}</div> }));
vi.mock("@/components/contacts/client-link", () => ({ ClientLink: ({ children }: { children: React.ReactNode }) => children }));
import { HoursProvider } from "@/components/pipeline/timer";
import type { BusinessHours } from "@/lib/business-hours";
import type { DealDetail } from "@/server/queries/deal";
import type { LeadActions } from "./use-lead-actions";
import { ClientPane } from "./client-pane";

afterEach(cleanup);
const allDay: [string, string] = ["00:00", "24:00"];
const HOURS: BusinessHours = { 0: allDay, 1: allDay, 2: allDay, 3: allDay, 4: allDay, 5: allDay, 6: allDay };
const future = new Date(Date.now() + 3 * 86_400_000).toISOString();

const d = (over: { deal?: object; stage?: object; context?: object; contact?: object; nextAction?: object | null; scheduled?: object[]; attempt?: object | null; phonePeople?: object | null } = {}) => ({
  phonePeople: over.phonePeople ?? null,
  deal: { id: "d1", ownerId: "sara", awaitingReplySince: new Date(Date.now() - 12 * 60_000).toISOString(), conversationArchivedAt: null, resolvedAt: null, lastInboundAt: null, lastReplyById: null, scheduledAt: null, attendance: null, followupAttempt: 0, followupDueAt: null, serviceId: null, observations: null, ...over.deal },
  contact: { id: "c1", name: "Thamires Lopes", phoneE164: "+5571990000003", avatarPath: null, isClient: true, kind: "cliente", email: null, instagram: null, notes: null, importedFields: null,
    nickname: null, phoneAlt: null, hairType: null, alertNotes: null, cpf: null, birthDay: null, birthMonth: null, birthYear: null, ...(over as { contact?: object }).contact },
  stage: { key: "atendimento", name: "Em atendimento", kind: "atendimento", color: "#1938d2", slaMinutes: 15, ...over.stage },
  stages: [], ownerName: "Sara Lima", lastReplyName: null, late: false, sourceLabel: "Instagram", channelName: "Recepção", services: [], lostReasons: [], messages: [], people: [],
  tags: [{ name: "Método Fiaes" }, { name: "VIP" }], tagOptions: [], notes: [], quickReplies: [], professionals: [], sources: [], origins: [],
  nextAction: over.nextAction ?? null, scheduled: over.scheduled ?? [], attempt: over.attempt ?? null,
  context: {
    firstContactAt: "2023-02-01T12:00:00Z", knownSince: "2023-02-01T12:00:00Z", isFirstContact: false, lastVisit: { at: new Date(Date.now() - 20 * 86_400_000).toISOString(), service: null, by: null }, visits: 9,
    lastSales: [], totalCents: null, previousOwner: null, activePackage: { packageName: "Método", usedSessions: 3, totalSessions: 4 },
    nextAppointment: { startsAt: future, serviceLabel: "Manutenção Método Fiaes", professionalName: "ROSE", requested: true },
    situation: "", short: "", states: [], retorno: null, preferredProfessional: null, alertNotes: null, ...over.context,
  },
}) as unknown as DealDetail;
const actions = () => ({ open: vi.fn(), openResume: vi.fn(), orcamento: vi.fn(), doneResume: vi.fn(), cancelResume: vi.fn(), birthday: vi.fn(), claim: vi.fn(), transfer: vi.fn(), archiveConversation: vi.fn(), setStatus: vi.fn(),
  unarchiveConversation: vi.fn(), attendance: vi.fn(), moveTo: vi.fn(), setOrigin: vi.fn(), busy: false }) as unknown as Record<string, ReturnType<typeof vi.fn>>;
const gestora = { id: "g1", perms: ["atendimento.ver", "atendimento.todas", "atendimento.transferir", "atendimento.fechar", "contatos.ver"] } as never;
const pane = (detail: DealDetail, a = actions(), tab: "agora" | "cliente" = "agora") =>
  render(<HoursProvider hours={HOURS}><ClientPane d={detail} tab={tab} onTab={() => {}} viewer={gestora} actions={a as unknown as LeadActions} /></HoursProvider>);

it("aba Agora: a frase da situação, o cartão único do próximo passo e os 3 botões do que fazer; nada de Fechar venda, Não é cliente solto ou PRÓXIMA AÇÃO", () => {
  pane(d());
  expect(screen.getByRole("tab", { name: "Agora" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByTestId("situacao-conversa").textContent).toMatch(/^Esperando a Casa · Responda em \d+ min$/);
  const passo = screen.getByRole("region", { name: "Próximo passo" });
  expect(passo.textContent).toContain("Manutenção Método Fiaes");
  expect(passo.textContent).toContain("com Rose · Pediu ela");
  const fazer = screen.getByRole("region", { name: "O que fazer" });
  expect(within(fazer).getAllByRole("button").map((b) => b.textContent)).toEqual(["Agendar horário", "Retomar…", "R$Mandar orçamento"]);
  const txt = document.body.textContent ?? "";
  for (const t of ["Fechar venda", "Não é cliente", "PRÓXIMA AÇÃO", "Próxima ação", "Enviei orçamento"]) expect(txt).not.toContain(t);
});

it("os botões fazem o que dizem: Agendar, Retomar (diálogo único) e Mandar orçamento", () => {
  const a = actions();
  pane(d(), a);
  const fazer = screen.getByRole("region", { name: "O que fazer" });
  fireEvent.click(within(fazer).getByRole("button", { name: "Agendar horário" }));
  fireEvent.click(within(fazer).getByRole("button", { name: "Retomar…" }));
  fireEvent.click(within(fazer).getByRole("button", { name: /Mandar orçamento/ }));
  expect(a.open).toHaveBeenCalledWith("schedule");
  expect(a.openResume).toHaveBeenCalled();
  expect(a.orcamento).toHaveBeenCalled();
});

it("retomada ativa vira o cartão do próximo passo (Feito / Trocar); mensagem programada diz que sai sozinha; a linha das tentativas aparece", () => {
  const a = actions();
  const due = new Date(Date.now() + 86_400_000).toISOString();
  pane(d({ deal: { awaitingReplySince: null }, nextAction: { id: "t1", title: "Ver se ela decidiu", dueAt: due, assigneeName: "Sara Lima" },
    scheduled: [{ id: "o1", text: "Oi! Conseguiu ver?", at: due, taskId: "t1", authorName: null, cancelIfReply: true }],
    attempt: { n: 2, lostAt: new Date(Date.now() + 3 * 86_400_000).toISOString() } }), a);
  expect(screen.getByTestId("situacao-conversa").textContent).toBe("Esperando a cliente");
  expect(screen.getByTestId("tentativa").textContent).toMatch(/^Tentativa 2 de 3 · vira Perdido \S+$/);
  const card = screen.getByTestId("cartao-retomada");
  expect(card.textContent).toContain("Mensagem sai");
  expect(card.textContent).toContain("Ver se ela decidiu. Sai sozinha.");
  fireEvent.click(within(card).getByRole("button", { name: "Feito" }));
  fireEvent.click(within(card).getByRole("button", { name: "Trocar" }));
  expect(a.doneResume).toHaveBeenCalled();
  expect(a.openResume).toHaveBeenCalledWith({ motivo: "Ver se ela decidiu", text: "Oi! Conseguiu ver?" });
});

it("aba Cliente: números, pacote, Dados da cliente com Editar dados e Adicionar nos vazios, etiquetas e Abrir ficha; CPF visível para a equipe", () => {
  const a = actions();
  pane(d({ contact: { email: "rita@exemplo.test", hairType: "cacheado 3B", cpf: "52998224725" } }), a, "cliente");
  const dados = screen.getByRole("region", { name: "Dados da cliente" });
  expect(dados.textContent).toContain("rita@exemplo.test");
  expect(dados.textContent).toContain("cacheado 3B");
  expect(dados.textContent).toContain("529.982.247-25");
  fireEvent.click(within(dados).getAllByRole("button", { name: "Adicionar" })[0]);
  fireEvent.click(within(dados).getByRole("button", { name: "Editar dados" }));
  expect(a.open.mock.calls).toEqual([["dados"], ["dados"]]);
  expect(screen.getByRole("region", { name: "Etiquetas" }).textContent).toContain("Método Fiaes");
  expect(screen.getByRole("link", { name: "Abrir ficha ›" }).getAttribute("href")).toBe("/contatos/c1");
});

it("sem horário marcado o cartão diz isso; agendada, o botão vira Remarcar horário", () => {
  pane(d({ context: { nextAppointment: null }, deal: { awaitingReplySince: null } }));
  expect(screen.getByRole("region", { name: "Próximo passo" }).textContent).toContain("Nada marcado");
  cleanup();
  pane(d({ stage: { kind: "agendado", name: "Agendado", key: "agendado" } }));
  expect(within(screen.getByRole("region", { name: "O que fazer" })).getByRole("button", { name: "Remarcar horário" })).toBeTruthy();
});

it("resumo da IA guardado aparece na aba Agora; sem resumo, nada; o cartão do horário não repete o Remarcar", () => {
  pane({ ...d(), aiResumo: { text: "Quer marcar manutenção do Método no sábado de manhã.", at: new Date().toISOString() } } as DealDetail);
  expect(screen.getByTestId("resumo-ia").textContent).toBe("Resumo da IA: Quer marcar manutenção do Método no sábado de manhã.");
  expect(screen.getByTestId("cartao-horario").querySelectorAll("button").length).toBeLessThanOrEqual(1);
  expect(screen.queryAllByRole("button", { name: "Remarcar" })).toHaveLength(0);
});
it("sem resumo da IA não mostra o bloco", () => {
  pane(d());
  expect(screen.queryByTestId("resumo-ia")).toBeNull();
});

it("aba Cliente: a foto do WhatsApp aparece grande e amplia ao tocar", () => {
  pane(d({ contact: { avatarPath: "avatars/c1.jpg" } }), actions(), "cliente");
  const foto = screen.getByRole("button", { name: "Ver a foto de Thamires Lopes" });
  expect(Number(foto.querySelector("img")?.getAttribute("width"))).toBeGreaterThanOrEqual(88);
  fireEvent.click(foto);
  expect(screen.getByRole("dialog", { name: "Foto de Thamires Lopes" })).toBeTruthy();
});

it("aba Cliente sem foto: as iniciais grandes, sem botão de ampliar", () => {
  pane(d(), actions(), "cliente");
  expect(screen.queryByRole("button", { name: /Ver a foto/ })).toBeNull();
  expect(screen.getByText("TL")).toBeTruthy();
});

it("Como conheceu: a origem gravada como Retorno sugerido aparece como Hora de voltar", () => {
  pane({ ...d(), sourceLabel: "Retorno sugerido" } as DealDetail, actions(), "cliente");
  const dados = screen.getByRole("region", { name: "Dados da cliente" });
  expect(dados.textContent).toContain("Hora de voltar");
  expect(dados.textContent).not.toContain("Retorno sugerido");
});

it("Automáticas pausadas: o interruptor aparece com a função ligada e a permissão; sem uma das duas some", () => {
  const pausar = { id: "g1", perms: ["atendimento.ver", "atendimento.pausar", "contatos.ver"] } as never;
  const withPause = (extra: object) => ({ ...d(), pauseSwitch: true, pause: "sempre", ...extra }) as unknown as DealDetail;
  const r = (detail: DealDetail, viewer: never) => render(<HoursProvider hours={HOURS}><ClientPane d={detail} tab="agora" onTab={() => {}} viewer={viewer} actions={actions() as unknown as LeadActions} /></HoursProvider>);
  r(withPause({}), pausar);
  expect(screen.getByTestId("pausa").textContent).toBe("sempre");
  cleanup();
  r(withPause({ pauseSwitch: false }), pausar);
  expect(screen.queryByTestId("pausa")).toBeNull();
  cleanup();
  r(withPause({}), gestora);
  expect(screen.queryByTestId("pausa")).toBeNull();
});

/** Mãe (titular, a conversa) e a filha no mesmo celular (0051). */
const maeEFilha = (filhaNext: object | null, maeNext: object | null = null) => ({ holderId: "c1", holderName: "Thamires Lopes", holderPhone: "+5571990000003", people: [
  { id: "c1", name: "Thamires Lopes", relation: null, isHolder: true, next: maeNext },
  { id: "c2", name: "Vera Klein", relation: "filha", isHolder: false, next: filhaNext },
] });

it("mãe e filha no mesmo número (21/10): a aba Agora diz quem usa o número e o próximo horário de cada uma", () => {
  const amanha = new Date(Date.now() + 86_400_000).toISOString();
  pane(d({ phonePeople: maeEFilha({ id: "a2", startsAt: amanha, serviceLabel: "Escova", professionalName: "BIA" }) }));
  const bloco = screen.getByRole("region", { name: "Neste número" });
  const linhas = within(bloco).getAllByRole("listitem").map((li) => li.textContent);
  expect(linhas[0]).toMatch(/^Thamires.*a conversa é dela.*Sem horário marcado$/);
  expect(linhas[1]).toMatch(/^Bruna.*filha.*Escova com Bia$/);
  expect(within(bloco).getByRole("link", { name: "Vera Klein" }).getAttribute("href")).toContain("c2");
});

it("só ela no número: nada de bloco Neste número", () => {
  pane(d({ phonePeople: { holderId: "c1", holderName: "Thamires Lopes", holderPhone: "+5571990000003", people: [{ id: "c1", name: "Thamires Lopes", relation: null, isHolder: true, next: null }] } }));
  expect(screen.queryByRole("region", { name: "Neste número" })).toBeNull();
});

it("a mãe sem horário e a filha com horário: o próximo passo mostra o horário da filha, dizendo de quem é", () => {
  const amanha = new Date(Date.now() + 86_400_000).toISOString();
  pane(d({ context: { nextAppointment: null, nextVisit: [] }, stage: { key: "agendado", kind: "agendado" }, deal: { scheduledAt: amanha },
    phonePeople: maeEFilha({ id: "a2", startsAt: amanha, serviceLabel: "Escova", professionalName: "BIA" }) }));
  const card = screen.getByTestId("cartao-horario");
  expect(card.textContent).toContain("Horário de Vera Klein (filha)");
  expect(card.textContent).toContain("Escova · com Bia");
});
