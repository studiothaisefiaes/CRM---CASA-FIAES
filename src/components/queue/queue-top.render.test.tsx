// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent, within } from "@testing-library/react";
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }), useSearchParams: () => new URLSearchParams("view=meus&foco=atrasados") }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
vi.mock("@/app/(app)/funil/actions", () => ({ newConversationAction: vi.fn() }));
import { QueueTop } from "./queue-top";
import { QueueSelectionProvider } from "./queue-selection";
import type { QueueCounts } from "@/server/queries/queue";
afterEach(() => { cleanup(); replace.mockReset(); });
window.matchMedia ??= ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

const counts = { total: 9, aguardando: 3, atrasados: 1, perto: 0, agendadosHoje: 2, parados: 0, acoesHoje: 0, tarefasAtrasadas: 4, reclamacoes: 0, eventos: 0, naoLidas: 2,
  views: { todos: 9, meus: 1, "sem-dono": 3, parados: 0, "agendados-hoje": 2, "clientes-ativos": 0, "sem-contato-90d": 0, arquivadas: 128 } } as QueueCounts;
const opts = { stages: [{ key: "lead", name: "Novo contato", color: "#e00000" }, { key: "agendado", name: "Agendado", color: "#0a9a2a" }], owners: [{ id: "u1", name: "Sara Lima" }], tags: [{ id: "t1", name: "VIP", uses: 3 }] };
const top = (params: Record<string, string> = {}) => render(<QueueSelectionProvider><QueueTop params={params} counts={counts} options={opts} /></QueueSelectionProvider>);

it("no topo cinco abas (Todas padrão, Esperando, Não lidas, Para retomar, Resolvidas) com o número; nada de chips de Minhas/Esperando/Sem dono/Atrasados", () => {
  top();
  const abas = screen.getByRole("navigation", { name: "Abas da fila" });
  const links = within(abas).getAllByRole("link");
  expect(links.map((a) => [a.textContent, a.getAttribute("href"), a.getAttribute("aria-current")])).toEqual([
    ["Todas 9", "/atendimento?view=todos", "page"], ["Esperando 3", "/atendimento?foco=aguardando", null], ["Não lidas 2", "/atendimento?aba=nao-lidas", null], ["Para retomar 0", "/atendimento?foco=retomar", null], ["Resolvidas 128", "/atendimento?view=resolvidas", null],
  ]);
  expect(screen.queryByRole("group", { name: "Resumo da fila" })).toBeNull();
  expect(screen.queryByText(/^Sem dono/)).toBeNull();
  expect(screen.getByRole("searchbox", { name: "Buscar na fila" }).getAttribute("placeholder")).toBe("Nome, telefone ou mensagem");
  expect(screen.getByRole("button", { name: "Filtros" }).textContent).toBe("Filtros");
  expect(screen.getByRole("heading", { level: 2, name: "Fila" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Selecionar" })).toBeTruthy();
});

it("filtros ligados aparecem embaixo da busca como chips com ✕ (cada um tira só ele) e o botão diz quantos", () => {
  top({ view: "meus", foco: "atrasados", dono: "u1", etiqueta: "t1" });
  expect(screen.getByRole("button", { name: "Filtros · 4 ligados" }).textContent).toBe("Filtros · 4");
  const chips = within(screen.getByRole("group", { name: "Filtros ligados" })).getAllByRole("link");
  expect(chips.map((c) => [c.getAttribute("aria-label"), c.textContent])).toEqual([
    ["Tirar o filtro Minhas", "Minhas✕"], ["Tirar o filtro Atrasados", "Atrasados✕"], ["Tirar o filtro Dona: Sara Lima", "Dona: Sara Lima✕"], ["Tirar o filtro Etiqueta: VIP", "Etiqueta: VIP✕"],
  ]);
  expect(chips[0].getAttribute("href")).toBe("/atendimento?foco=atrasados&dono=u1&etiqueta=t1");
  // A aba ativa continua sendo Todas: os filtros valem dentro dela.
  expect(within(screen.getByRole("navigation", { name: "Abas da fila" })).getByRole("link", { name: "Todas 9" }).getAttribute("aria-current")).toBe("page");
});

it("o painel Filtros junta Minhas, Esperando, Sem dono, Atrasados, Combinados, etapa do funil, dona e etiqueta; tocar aplica na hora", () => {
  top({ view: "meus" });
  fireEvent.click(screen.getByRole("button", { name: /^Filtros/ }));
  const dlg = screen.getByRole("dialog", { name: "Filtros" });
  const mostrar = within(dlg).getByRole("group", { name: "Quem" });
  expect(within(mostrar).getByRole("button", { name: "Minhas 1" }).getAttribute("aria-pressed")).toBe("true");
  expect(within(mostrar).getByRole("button", { name: "Sem dono 3" }).getAttribute("aria-pressed")).toBe("false");
  const situacao = within(dlg).getByRole("group", { name: "Situação" });
  for (const n of ["Esperando 3", "Atrasados 1", "Combinados vencidos 4"]) expect(within(situacao).getByRole("button", { name: n })).toBeTruthy();
  fireEvent.click(within(situacao).getByRole("button", { name: "Esperando 3" }));
  expect(replace).toHaveBeenLastCalledWith("/atendimento?view=meus&foco=aguardando", { scroll: false });
  fireEvent.change(within(dlg).getByRole("combobox", { name: "Etapa da conversa" }), { target: { value: "agendado" } });
  expect(replace).toHaveBeenLastCalledWith("/atendimento?view=meus&foco=atrasados&etapa=agendado", { scroll: false });
  expect(within(dlg).getByRole("combobox", { name: "Dona" })).toBeTruthy();
  expect(within(dlg).getByRole("combobox", { name: "Filtrar por etiqueta" })).toBeTruthy();
});

it("sem permissão de ver as conversas de todas, o painel não oferece filtro por dona", () => {
  render(<QueueSelectionProvider><QueueTop params={{}} counts={counts} options={{ ...opts, owners: [] }} /></QueueSelectionProvider>);
  fireEvent.click(screen.getByRole("button", { name: /^Filtros/ }));
  expect(within(screen.getByRole("dialog", { name: "Filtros" })).queryByRole("combobox", { name: "Dona" })).toBeNull();
});

it("Equipe com mensagem nova acende embaixo das abas e leva à lista da Equipe; Filtros tem Equipe, Fornecedores e Spam", () => {
  render(<QueueSelectionProvider><QueueTop params={{ view: null }} counts={{ ...counts, equipeNaoLidas: 2, views: { ...counts.views, equipe: 3, fornecedores: 2, "nao-cliente": 1 } }} options={opts} /></QueueSelectionProvider>);
  const aviso = screen.getByRole("link", { name: /Equipe: 2 conversas não lidas/ });
  expect(aviso.getAttribute("href")).toBe("/atendimento?view=equipe");
  fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
  const fora = screen.getByRole("group", { name: "Fora das etapas" });
  expect(within(fora).getByRole("button", { name: /Equipe 3/ })).toBeTruthy();
  expect(within(fora).getByRole("button", { name: /Fornecedores 2/ })).toBeTruthy();
  expect(within(fora).getByRole("button", { name: /Spam 1/ })).toBeTruthy();
});

it("o painel tem Sem dona, Mais etiquetas com Tem qualquer/Tem todas/Não tem e Dias sem conversar; cada um aplica na hora e mantém os outros filtros", () => {
  top({ view: "meus" });
  fireEvent.click(screen.getByRole("button", { name: /^Filtros/ }));
  const dlg = screen.getByRole("dialog", { name: "Filtros" });
  fireEvent.change(within(dlg).getByRole("combobox", { name: "Dona" }), { target: { value: "sem" } });
  expect(replace).toHaveBeenLastCalledWith("/atendimento?view=meus&foco=atrasados&dono=sem", { scroll: false });
  fireEvent.click(within(dlg).getByRole("button", { name: "Não tem" }));
  expect(replace).toHaveBeenLastCalledWith("/atendimento?view=meus&foco=atrasados&regra=nao_tem", { scroll: false });
  fireEvent.change(within(dlg).getByRole("combobox", { name: "Dias sem conversar" }), { target: { value: "30" } });
  expect(replace).toHaveBeenLastCalledWith("/atendimento?view=meus&foco=atrasados&dias=30", { scroll: false });
});
