// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace() {}, push() {} }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/atendimento" }));
const follow = vi.fn(async () => ({ ok: true })), unread = vi.fn(async () => ({ ok: true }));
vi.mock("@/app/(app)/conversa/actions", () => ({ followAction: (...a: unknown[]) => (follow as never as (...x: unknown[]) => unknown)(...a), markUnreadAction: (...a: unknown[]) => (unread as never as (...x: unknown[]) => unknown)(...a) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));
vi.mock("./queue-route", () => ({ BackToQueue: () => null }));
vi.mock("@/components/contacts/client-link", () => ({ ClientLink: ({ children }: { children: React.ReactNode }) => children }));
import type { DealDetail } from "@/server/queries/deal";
import type { LeadActions } from "./use-lead-actions";
import { PaneHeader } from "./pane-header";

afterEach(cleanup);

const stages = [
  { key: "lead", name: "Novo contato", kind: "lead", color: "#e00000" }, { key: "atendimento", name: "Em atendimento", kind: "atendimento", color: "#1938d2" },
  { key: "agendado", name: "Agendado", kind: "agendado", color: "#0a9a2a" }, { key: "na_casa", name: "Na Casa", kind: "na_casa", color: "#b5654a" },
  { key: "fechado", name: "Fechado", kind: "fechado", color: "#5c5c5c" },
];
const detail = (over: Partial<DealDetail["deal"]> = {}) => ({
  deal: { id: "d1", ownerId: "sara", awaitingReplySince: new Date(Date.now() - 60_000).toISOString(), conversationArchivedAt: null, resolvedAt: null, lastReplyById: null, lastOutboundAt: null, closedAt: null, archivedAt: null, ...over },
  contact: { id: "c1", name: "Thamires Lopes", phoneE164: "+5571990000003", avatarPath: null, isClient: true, email: null, instagram: null },
  stage: { key: "atendimento", name: "Em atendimento", kind: "atendimento", color: "#1938d2", slaMinutes: 15 },
  stages, ownerName: "Sara Lima", late: false, sourceLabel: "Instagram", channelName: "Recepção",
  context: { knownSince: "2023-02-01T12:00:00Z", firstContactAt: "2023-02-01T12:00:00Z" },
  people: [{ id: "sara", name: "Sara Lima", availability: "disponivel", priorityLevel: 1, waiting: 2 }, { id: "cati", name: "Cati", availability: "disponivel", priorityLevel: 1, waiting: 0 }],
}) as unknown as DealDetail;
const actions = () => ({ openResume: vi.fn(), moveTo: vi.fn(), open: vi.fn(), claim: vi.fn(), transfer: vi.fn(), resolve: vi.fn(), archiveConversation: vi.fn(), setStatus: vi.fn(), unarchiveConversation: vi.fn(), notClient: vi.fn(), busy: false }) as unknown as LeadActions & Record<string, ReturnType<typeof vi.fn>>;
const gestora = { id: "g1", perms: ["atendimento.ver", "atendimento.todas", "atendimento.transferir", "atendimento.fechar"] } as never;

const head = (d: DealDetail, a = actions(), viewer = gestora) =>
  render(<PaneHeader item={null} d={d} name="Thamires Lopes" answered={false} back={false} actions={a} viewer={viewer} onClose={() => {}} />);

it("cabeçalho: nome, telefone formatado e 'Cliente desde'; à direita só etapa ▾, status ▾ (ao lado), 'Com:' ▾ e Assumir", () => {
  head(detail());
  expect(screen.getByRole("heading", { name: "Thamires Lopes" })).toBeTruthy();
  expect(screen.getByText("(71) 99000-0003 · Cliente desde 2023")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Trocar etapa: Em atendimento" }).textContent).toContain("▾");
  expect(screen.getByRole("button", { name: "Status: Aberto. Trocar status" }).textContent).toContain("Aberto");
  expect(screen.getByRole("button", { name: "Com Sara Lima. Passar para…" }).textContent).toContain("Com: Sara");
  expect(screen.getByRole("button", { name: "Assumir" })).toBeTruthy();
  // Nada de status duplicado, "Em atendimento" como status, "Não precisa responder" ou "Encerrar conversa".
  const header = document.body.textContent ?? "";
  for (const t of ["Não precisa responder", "Encerrar conversa", "Resolvido (não"]) expect(header).not.toContain(t);
  expect(screen.getAllByTestId("status-conversa")).toHaveLength(1);
});

it("etapa ▾ troca a etapa (Na Casa aparece; Fechado e Aguardando cliente não, 16/10); 'Com:' ▾ abre Passar para…; Assumir assume", () => {
  const a = actions();
  head(detail(), a);
  fireEvent.click(screen.getByRole("button", { name: "Trocar etapa: Em atendimento" }));
  const menu = screen.getByRole("menu", { name: "Trocar etapa: Em atendimento" });
  expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Novo contato", "Agendado", "Na Casa"]);
  fireEvent.click(within(menu).getByRole("menuitem", { name: "Na Casa" }));
  expect(a.moveTo).toHaveBeenCalledWith("na_casa");
  fireEvent.click(screen.getByRole("button", { name: "Com Sara Lima. Passar para…" }));
  expect(a.open).toHaveBeenCalledWith("passar");
  fireEvent.click(screen.getByRole("button", { name: "Assumir" }));
  expect(a.claim).toHaveBeenCalled();
});

it("status ▾: Aberto, Aguardando, Para retomar e Resolvido (Resolvido = o antigo Encerrar); a escolha chama setStatus; Para retomar abre o Retomar", () => {
  const a = actions();
  const { unmount } = head(detail(), a);
  fireEvent.click(screen.getByRole("button", { name: /^Status: Aberto/ }));
  const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
  expect(items.map((i) => i.textContent)).toEqual([expect.stringMatching(/^Aberto/), expect.stringMatching(/^Aguardando/), expect.stringMatching(/^Para retomar/), expect.stringMatching(/^Resolvido/)]);
  fireEvent.click(items[3]);
  expect(a.setStatus).toHaveBeenCalledWith("resolvido");
  fireEvent.click(screen.getByRole("button", { name: /^Status: Aberto/ }));
  fireEvent.click(within(screen.getByRole("menu")).getAllByRole("menuitem")[2]);
  expect(a.openResume).toHaveBeenCalled();
  unmount();
  head(detail({ conversationArchivedAt: "2026-10-15T13:00:00Z" as never, awaitingReplySince: null }), a);
  fireEvent.click(screen.getByRole("button", { name: /^Status: Resolvido/ }));
  fireEvent.click(within(screen.getByRole("menu")).getAllByRole("menuitem")[0]);
  expect(a.setStatus).toHaveBeenCalledWith("aberto");
});

it("a Casa falou por último: Aguardando; atrasada: o Aberto avisa o prazo; sem permissão de passar, 'Com:' é só texto", () => {
  head({ ...detail({ awaitingReplySince: null }), nextAction: null } as unknown as DealDetail, actions());
  expect(screen.getByRole("button", { name: /^Status: Aguardando/ })).toBeTruthy();
  cleanup();
  head({ ...detail({ awaitingReplySince: null }), nextAction: { title: "Retomar", dueAt: "2026-10-24T13:00:00Z" } } as unknown as DealDetail, actions());
  expect(screen.getByRole("button", { name: /^Status: Para retomar · sáb\. 24\/10 10:00/ })).toBeTruthy();
  cleanup();
  head({ ...detail(), late: true } as DealDetail, actions());
  expect(screen.getByRole("button", { name: "Status: Aberto, passou do prazo. Trocar status" })).toBeTruthy();
  cleanup();
  head(detail(), actions(), { id: "sara", perms: ["atendimento.ver"] } as never);
  expect(screen.queryByRole("button", { name: "Assumir" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Passar para/ })).toBeNull();
  expect(screen.getByTestId("dona").textContent).toBe("Com: Sara");
});

it("Registrar ligação: no ⋯ e no telefone discreto ao lado do nome; abre o diálogo de registro", () => {
  const a = actions();
  head(detail(), a);
  fireEvent.click(screen.getByRole("button", { name: "Registrar ligação feita" }));
  expect(a.open).toHaveBeenCalledWith("ligacao");
  fireEvent.click(screen.getByRole("button", { name: "Mais ações" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Registrar ligação" }));
  expect(a.open).toHaveBeenCalledTimes(2);
});

it("⋯: “Marcar como” equipe, fornecedor e spam (o tipo atual não aparece); o selo do tipo aparece ao lado do nome", () => {
  const a = { ...actions(), setKind: vi.fn() } as unknown as LeadActions & Record<string, ReturnType<typeof vi.fn>>;
  const d = detail();
  (d.contact as { kind: string }).kind = "cliente";
  head(d, a);
  expect(screen.queryByTestId("tipo-contato")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Mais ações" }));
  const menu = screen.getByRole("menu", { name: "Mais ações" });
  for (const t of ["Marcar como equipe", "Marcar como fornecedor", "Marcar como spam"]) expect(within(menu).getByRole("menuitem", { name: new RegExp(t) })).toBeTruthy();
  expect(within(menu).queryByRole("menuitem", { name: /Marcar como cliente/ })).toBeNull();
  fireEvent.click(within(menu).getByRole("menuitem", { name: /Marcar como fornecedor/ }));
  expect(a.setKind).toHaveBeenCalledWith("fornecedor");
  cleanup();
  const f = detail();
  (f.contact as { kind: string }).kind = "fornecedor";
  head(f, a);
  expect(screen.getByTestId("tipo-contato").textContent).toBe("Fornecedor");
});

it("Resolver à vista na faixa (Aberto e Aguardando), ao lado de Com: e Assumir; chama a mesma ação do status → Resolvido", () => {
  const a = actions();
  head(detail(), a); // Aberto
  const faixa = screen.getByTestId("faixa-conversa");
  fireEvent.click(within(faixa).getByRole("button", { name: "Resolver" }));
  expect(a.setStatus).toHaveBeenCalledWith("resolvido");
  cleanup();
  head(detail({ awaitingReplySince: null }), a); // Aguardando
  expect(within(screen.getByTestId("faixa-conversa")).getByRole("button", { name: "Resolver" })).toBeTruthy();
  cleanup();
  head(detail({ awaitingReplySince: null, conversationArchivedAt: new Date().toISOString() } as never), a); // Resolvido
  expect(within(screen.getByTestId("faixa-conversa")).queryByRole("button", { name: "Resolver" })).toBeNull();
});

it("foto do cabeçalho: a mesma URL (com versão) da Fila, para sair do cache do navegador", () => {
  const withPhoto = (checked: string) => { const d = detail(); (d.contact as unknown as Record<string, unknown>).avatarPath = "avatar-c1.jpg"; (d.contact as unknown as Record<string, unknown>).avatarCheckedAt = checked; return d; };
  const { container, unmount } = render(<PaneHeader item={{ avatarV: "1760000000", hasAvatar: true, contactId: "c1" } as never} d={withPhoto("2026-10-17T12:00:00Z")} name="Thamires Lopes" answered={false} back={false} actions={actions()} viewer={gestora} onClose={() => {}} />);
  expect(container.querySelector("img")?.getAttribute("src")).toBe("/api/avatar/c1?v=1760000000");
  unmount();
  // Sem o item da Fila (aberta por link): a versão sai da data em que o worker revisou a foto, igual à da Fila.
  const only = head(withPhoto("2026-10-17T12:00:00.400Z"));
  expect(only.container.querySelector("img")?.getAttribute("src")).toBe(`/api/avatar/c1?v=${Date.UTC(2026, 9, 17, 12) / 1000}`);
});

it("⋯ tem Acompanhar e Marcar como não lida só com a permissão e a função ligada; marcar como não lida fecha a conversa", async () => {
  const onClose = vi.fn();
  const d = detail(); (d as unknown as { tools: object }).tools = { acompanhar: true, naoLida: true, acompanhando: false };
  render(<PaneHeader item={null} d={d} name="Thamires Lopes" answered={false} back={false} actions={actions()} viewer={gestora} onClose={onClose} />);
  fireEvent.click(screen.getByRole("button", { name: "Mais ações" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Acompanhar" }));
  expect(follow).toHaveBeenCalledWith("d1", true);
  fireEvent.click(screen.getByRole("button", { name: "Mais ações" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Deixar de acompanhar" }));
  expect(follow).toHaveBeenLastCalledWith("d1", false);
  fireEvent.click(screen.getByRole("button", { name: "Mais ações" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Marcar como não lida" }));
  expect(unread).toHaveBeenCalledWith("d1");
  await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
});
it("sem as ferramentas, o ⋯ não oferece Acompanhar nem Marcar como não lida", () => {
  head(detail());
  fireEvent.click(screen.getByRole("button", { name: "Mais ações" }));
  expect(screen.queryByRole("menuitem", { name: "Acompanhar" })).toBeNull();
  expect(screen.queryByRole("menuitem", { name: "Marcar como não lida" })).toBeNull();
});
