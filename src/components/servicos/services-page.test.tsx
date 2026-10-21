// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { update, create, savePkg } = vi.hoisted(() => ({ update: vi.fn(async (..._a: unknown[]) => ({ ok: true as const })), create: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { id: "n" } })),
  savePkg: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { id: "p" } })) }));
vi.mock("@/app/(app)/servicos/actions", () => ({ updateServiceAction: (...a: unknown[]) => update(...a), createServiceAction: (...a: unknown[]) => create(...a), savePackageAction: (...a: unknown[]) => savePkg(...a) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { ServicesPage } from "./services-page";
import type { ServicePro, ServiceRow } from "@/server/domain/services";
import type { PackageCard } from "@/server/domain/caixa/packages";

afterEach(() => { cleanup(); update.mockClear(); create.mockClear(); savePkg.mockClear(); });

const ANA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROS: ServicePro[] = [{ id: ANA, name: "ANA PAULA", color: null, photoUrl: null }, { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Bia", color: null, photoUrl: null }];
const svc = (id: string, label: string, over: Partial<ServiceRow> = {}): ServiceRow => ({ id, label, category: null, priceCents: null, durationMin: null, bufferMin: null, cycleDays: null, description: null, active: true, professionalIds: [], aiProIds: [], aiProScope: null, aiCitavel: true, priceKind: null, parallelOk: null, proTerms: {}, fiscalCtribNac: null, fiscalNbs: null, ...over });
const MF = "11111111-1111-4111-8111-111111111111";
const ITEMS = [
  svc("22222222-2222-4222-8222-222222222222", "Corte Feminino", { category: "CABELO", priceCents: 26_400, durationMin: 60, professionalIds: [ANA] }),
  svc(MF, "Manutenção Método Fiaes", { category: "METODO FIAES", priceCents: 247_500, description: "Remoção, confecção e aplicação." }),
  svc("33333333-3333-4333-8333-333333333333", "MANICURE", { category: "MANICURE E PEDICURE", priceCents: 6_000, durationMin: 45 }),
  svc("44444444-4444-4444-8444-444444444444", "Antigo", { active: false }),
];

it("agrupa por categoria (Método Fiaes primeiro), nome e categoria sem maiúsculas gritadas, preço em destaque e quem faz", () => {
  render(<ServicesPage services={ITEMS} professionals={PROS} canEdit initialOpen={null} />);
  const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
  expect(headings).toEqual(["Método Fiaes®1", "Cabelo1", "Manicure e pedicure1"]);
  expect(screen.getByText("Manicure")).toBeTruthy();
  expect(screen.getByText("Remoção, confecção e aplicação.")).toBeTruthy();
  expect((screen.getByLabelText("Preço de Manutenção Método Fiaes") as HTMLInputElement).value).toBe("2.475,00");
  expect(screen.getByRole("img", { name: "Quem faz: Ana Paula" })).toBeTruthy();
  expect(screen.queryByText("Antigo")).toBeNull(); // desativado só no filtro
  expect(screen.getByRole("button", { name: "Novo serviço" })).toBeTruthy();
});

it("busca sem acento e filtros (sem duração, desativados)", () => {
  render(<ServicesPage services={ITEMS} professionals={PROS} canEdit initialOpen={null} />);
  fireEvent.change(screen.getByRole("searchbox", { name: "Buscar serviço" }), { target: { value: "metodo" } });
  expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Método Fiaes®1"]);
  fireEvent.change(screen.getByRole("searchbox", { name: "Buscar serviço" }), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: /Sem duração/ }));
  expect(screen.getByText("Manutenção Método Fiaes")).toBeTruthy();
  expect(screen.queryByText("Corte Feminino")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Desativados/ }));
  expect(screen.getByText("Antigo")).toBeTruthy();
});

it("psico r68 #20: preço na própria linha mostra 'R$ 264,00 → R$ 280,00' com Salvar e Cancelar; só grava em Salvar; inválido volta", async () => {
  render(<ServicesPage services={ITEMS} professionals={PROS} canEdit initialOpen={null} />);
  const preco = screen.getByLabelText("Preço de Corte Feminino") as HTMLInputElement;
  fireEvent.change(preco, { target: { value: "280" } });
  fireEvent.blur(preco);
  expect(update).not.toHaveBeenCalled();
  const caixa = screen.getByRole("group", { name: "Confirmar novo preço de Corte Feminino" });
  expect(caixa.textContent).toContain("R$ 264,00");
  expect(caixa.textContent).toContain("R$ 280,00");
  fireEvent.click(within(caixa).getByRole("button", { name: "Cancelar" }));
  expect(preco.value).toBe("264,00");
  expect(update).not.toHaveBeenCalled();
  fireEvent.change(preco, { target: { value: "280" } });
  fireEvent.blur(preco);
  fireEvent.click(within(screen.getByRole("group", { name: "Confirmar novo preço de Corte Feminino" })).getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(update).toHaveBeenCalledWith("22222222-2222-4222-8222-222222222222", { priceCents: 28_000 }));
  fireEvent.change(preco, { target: { value: "abc" } });
  fireEvent.blur(preco);
  expect(update).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("group", { name: /Confirmar novo preço/ })).toBeNull();
});

it("atendente só consulta: sem Novo serviço, sem campo de preço nem interruptor; o painel mostra os dados", () => {
  render(<ServicesPage services={ITEMS} professionals={PROS} canEdit={false} initialOpen={null} />);
  expect(screen.queryByRole("button", { name: "Novo serviço" })).toBeNull();
  expect(screen.queryByLabelText(/Preço de/)).toBeNull();
  expect(screen.queryByRole("switch")).toBeNull();
  expect(screen.getAllByText("R$ 264,00").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: /Corte Feminino/ }));
  const d = within(screen.getByRole("dialog", { name: "Corte Feminino" }));
  expect(d.getByText("Ana Paula")).toBeTruthy();
  expect(d.queryByRole("textbox")).toBeNull();
});

it("painel: abre pelo link (?servico=) e salva só o que mudou, com quem faz", async () => {
  render(<ServicesPage services={ITEMS} professionals={PROS} canEdit initialOpen={MF} sheetOpts={CAN_COST} />);
  const d = within(screen.getByRole("dialog", { name: "Manutenção Método Fiaes" }));
  fireEvent.change(d.getByLabelText("Duração (min)"), { target: { value: "240" } });
  fireEvent.click(within(d.getByRole("group", { name: /^Quem faz/ })).getByRole("checkbox", { name: /Ana Paula/ }));
  fireEvent.click(d.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(update).toHaveBeenCalledWith(MF, { durationMin: 240, professionalIds: [ANA] }));
});

it("'A IA oferece só com' (17/10): escolhe a profissional e quando vale (só no assunto Método); salva só a regra; quem só consulta vê a regra", async () => {
  render(<ServicesPage services={ITEMS} professionals={PROS} canEdit initialOpen={MF} sheetOpts={CAN_COST} />);
  const d = within(screen.getByRole("dialog", { name: "Manutenção Método Fiaes" }));
  expect(d.queryByLabelText("Quando vale")).toBeNull();
  fireEvent.click(d.getByRole("checkbox", { name: "A IA oferece com Ana Paula" }));
  fireEvent.change(d.getByLabelText("Quando vale"), { target: { value: "metodo" } });
  fireEvent.click(d.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(update).toHaveBeenCalledWith(MF, { aiProIds: [ANA], aiProScope: "metodo" }));
  cleanup();
  const regra = ITEMS.map((x) => (x.id === MF ? { ...x, aiProIds: [ANA], aiProScope: "metodo" as const } : x));
  render(<ServicesPage services={regra} professionals={PROS} canEdit={false} initialOpen={MF} />);
  expect(screen.getByText(/A IA oferece só com:/).parentElement?.textContent).toContain("Ana Paula (só quando o assunto é o Método Fiaes®)");
});

it("'A IA pode citar' (0052): desligar salva só o campo; quem só consulta vê que a IA não cita", async () => {
  render(<ServicesPage services={ITEMS} professionals={PROS} canEdit initialOpen={MF} sheetOpts={CAN_COST} />);
  const d = within(screen.getByRole("dialog", { name: "Manutenção Método Fiaes" }));
  expect(d.getByText("Entra na lista de serviços e preços da IA.")).toBeTruthy();
  fireEvent.click(d.getByRole("switch", { name: "Tirar da lista da IA" }));
  expect(d.getByText(/Fica fora da lista da IA/)).toBeTruthy();
  fireEvent.click(d.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(update).toHaveBeenCalledWith(MF, { aiCitavel: false }));
  cleanup();
  render(<ServicesPage services={ITEMS.map((x) => (x.id === MF ? { ...x, aiCitavel: false } : x))} professionals={PROS} canEdit={false} initialOpen={MF} />);
  expect(screen.getByText("A IA não cita este serviço")).toBeTruthy();
});

it("Novo serviço: cria com nome, categoria, preço e descrição", async () => {
  render(<ServicesPage services={ITEMS} professionals={PROS} canEdit initialOpen={null} />);
  fireEvent.click(screen.getByRole("button", { name: "Novo serviço" }));
  const d = within(screen.getByRole("dialog", { name: "Novo serviço" }));
  fireEvent.change(d.getByLabelText("Nome"), { target: { value: "Escova modelada" } });
  fireEvent.change(d.getByLabelText("Categoria"), { target: { value: "CABELO" } });
  fireEvent.change(d.getByLabelText("Preço (R$)"), { target: { value: "125,00" } });
  fireEvent.change(d.getByLabelText("Descrição curta"), { target: { value: "Lisa ou cacheada." } });
  fireEvent.click(d.getByRole("button", { name: "Criar serviço" }));
  await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ label: "Escova modelada", category: "CABELO", priceCents: 12_500, description: "Lisa ou cacheada.", professionalIds: [] })));
});

it("Custo (R$) (Fase A): fica ao lado do preço, salva em centavos e vazio = sem custo; quem só consulta não vê o custo", async () => {
  render(<ServicesPage services={ITEMS.map((x) => (x.id === MF ? { ...x, costCents: 3_550 } : x))} professionals={PROS} canEdit initialOpen={MF} sheetOpts={CAN_COST} />);
  const d = within(screen.getByRole("dialog", { name: "Manutenção Método Fiaes" }));
  const custo = d.getByLabelText("Custo (R$)") as HTMLInputElement;
  expect(custo.value).toBe("35,50");
  fireEvent.change(custo, { target: { value: "40" } });
  fireEvent.click(d.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(update).toHaveBeenCalledWith(MF, { costCents: 4_000 }));
  cleanup(); update.mockClear();
  render(<ServicesPage services={ITEMS.map((x) => (x.id === MF ? { ...x, costCents: 3_550 } : x))} professionals={PROS} canEdit initialOpen={MF} sheetOpts={CAN_COST} />);
  const d2 = within(screen.getByRole("dialog", { name: "Manutenção Método Fiaes" }));
  fireEvent.change(d2.getByLabelText("Custo (R$)"), { target: { value: "" } });
  fireEvent.click(d2.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(update).toHaveBeenCalledWith(MF, { costCents: null }));
  cleanup();
  render(<ServicesPage services={ITEMS.map((x) => (x.id === MF ? { ...x, costCents: 3_550 } : x))} professionals={PROS} canEdit={false} initialOpen={MF} />);
  expect(screen.queryByText(/35,50/)).toBeNull();
  expect(screen.queryByLabelText("Custo (R$)")).toBeNull();
});

const CAN_COST = { canCost: true, canProTerms: false, precoPorPro: false, juntoComOutro: false };
it("Novo serviço com custo manda costCents", async () => {
  render(<ServicesPage services={ITEMS} professionals={PROS} canEdit initialOpen={null} sheetOpts={CAN_COST} />);
  fireEvent.click(screen.getByRole("button", { name: "Novo serviço" }));
  const d = within(screen.getByRole("dialog", { name: "Novo serviço" }));
  fireEvent.change(d.getByLabelText("Nome"), { target: { value: "Escova" } });
  fireEvent.change(d.getByLabelText("Custo (R$)"), { target: { value: "12,00" } });
  fireEvent.click(d.getByRole("button", { name: "Criar serviço" }));
  await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ label: "Escova", costCents: 1_200 })));
});

const PK = "55555555-5555-4555-8555-555555555555";
const PACKS: PackageCard[] = [
  { id: PK, name: "Combo Manutenção Método Fiaes", priceCents: 800_000, validityDays: 365, description: "4 manutenções completas.", active: true, sessions: 4, activeClients: 2,
    items: [{ serviceId: MF, sessions: 4, unitCents: null }, { serviceId: "22222222-2222-4222-8222-222222222222", sessions: 4, unitCents: null }], serviceLabels: ["Manutenção Método Fiaes", "Corte Feminino"] },
  { id: "66666666-6666-4666-8666-666666666666", name: "Combo antigo", priceCents: 10_000, validityDays: null, description: null, active: false, sessions: 2, activeClients: 0,
    items: [{ serviceId: MF, sessions: 2, unitCents: null }], serviceLabels: ["Manutenção Método Fiaes"] },
];

describe("Serviços · Pacotes · Fidelidade (uma tela só)", () => {
  it("abas no topo: Serviços, Pacotes e Fidelidade (sem Clientes com pacote, que é de Clientes), como links (?aba=)", () => {
    render(<ServicesPage services={ITEMS} packages={PACKS} professionals={PROS} canEdit initialOpen={null} />);
    const nav = within(screen.getByRole("navigation", { name: "Serviços e pacotes" }));
    expect(nav.getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href"), a.getAttribute("aria-current")])).toEqual([
      ["Serviços3", "/servicos", "page"], ["Pacotes1", "/servicos?aba=pacotes", null], ["Fidelidade", "/servicos?aba=fidelidade", null]]);
    expect(screen.getByRole("button", { name: "Novo serviço" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Novo pacote" })).toBeNull();
  });

  it("na lista de serviços e no painel: 'Também em pacote' com nome, sessões e preço do pacote ativo", () => {
    render(<ServicesPage services={ITEMS} packages={PACKS} professionals={PROS} canEdit initialOpen={null} />);
    expect(screen.getAllByText(/Também em pacote: Combo Manutenção Método Fiaes · 4 sessões · R\$\s8\.000,00/)).toHaveLength(2); // Manutenção e Corte
    expect(screen.queryByText(/Combo antigo/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Corte Feminino/ }));
    const d = within(screen.getByRole("dialog", { name: "Corte Feminino" }));
    expect(d.getByRole("link", { name: /Combo Manutenção Método Fiaes · 4 sessões · R\$\s8\.000,00/ }).getAttribute("href")).toBe(`/servicos?aba=pacotes&pacote=${PK}`);
  });

  it("aba Pacotes: cartão com nome, serviços, sessões, preço total em destaque e por sessão, validade e link para as clientes; desativado no fim", () => {
    render(<ServicesPage tab="pacotes" services={ITEMS} packages={PACKS} professionals={PROS} canEdit initialOpen={null} />);
    expect(screen.queryByText("Corte Feminino")).toBeNull(); // nenhuma linha de serviço
    expect(screen.getByRole("button", { name: "Novo pacote" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Novo serviço" })).toBeNull();
    const card = within(screen.getByRole("article", { name: "Combo Manutenção Método Fiaes" }));
    expect(card.getByText("Manutenção Método Fiaes + Corte Feminino")).toBeTruthy();
    expect(card.getByText("4 sessões")).toBeTruthy();
    expect(card.getByText(/R\$\s8\.000,00/)).toBeTruthy();
    expect(card.getByText(/R\$\s2\.000,00 por sessão/)).toBeTruthy();
    expect(card.getByText("Vale 1 ano")).toBeTruthy();
    expect(card.getByRole("link", { name: "2 clientes com o pacote ativo" }).getAttribute("href")).toBe(`/contatos?vista=pacote&pacote=${PK}`);
    const off = within(screen.getByRole("region", { name: /Desativados/ }));
    expect(off.getByRole("article", { name: "Combo antigo" })).toBeTruthy();
    expect(off.getByText("Nenhuma cliente com o pacote ativo")).toBeTruthy();
  });

  it("editar no painel grande: nome, serviço, sessões, preço, validade, descrição para a IA e ativo", async () => {
    render(<ServicesPage tab="pacotes" services={ITEMS} packages={PACKS} professionals={PROS} canEdit initialOpen={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Combo Manutenção Método Fiaes" }));
    const d = within(screen.getByRole("dialog", { name: "Combo Manutenção Método Fiaes" }));
    expect(d.getByText(/R\$\s2\.000,00 por sessão/)).toBeTruthy();
    fireEvent.change(d.getByLabelText("Preço do pacote (R$)"), { target: { value: "8.400,00" } });
    fireEvent.change(d.getByLabelText("Sessões de Manutenção Método Fiaes"), { target: { value: "5" } });
    fireEvent.click(d.getByRole("button", { name: "Tirar Corte Feminino" }));
    fireEvent.change(d.getByLabelText("Validade (dias)"), { target: { value: "180" } });
    fireEvent.change(d.getByLabelText("Descrição para a IA"), { target: { value: "5 manutenções." } });
    fireEvent.click(d.getByRole("switch", { name: "Desativar o pacote" }));
    fireEvent.click(d.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(savePkg).toHaveBeenCalledWith({ id: PK, name: "Combo Manutenção Método Fiaes", priceCents: 840_000, validityDays: 180, description: "5 manutenções.", active: false,
      items: [{ serviceId: MF, sessions: 5, unitCents: null }] }));
  });

  it("valor por sessão de cada serviço (base da comissão; antes só em /caixa/pacotes): mostra o salvo e vai junto ao salvar", async () => {
    const packs = [{ ...PACKS[0], items: [{ serviceId: MF, sessions: 4, unitCents: 40_000 }, PACKS[0].items[1]] }];
    render(<ServicesPage tab="pacotes" services={ITEMS} packages={packs} professionals={PROS} canEdit initialOpen={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Combo Manutenção Método Fiaes" }));
    const d = within(screen.getByRole("dialog", { name: "Combo Manutenção Método Fiaes" }));
    expect((d.getByLabelText("Valor por sessão de Manutenção Método Fiaes (R$)") as HTMLInputElement).value).toBe("400,00");
    fireEvent.change(d.getByLabelText("Valor por sessão de Corte Feminino (R$)"), { target: { value: "50" } });
    fireEvent.change(d.getByLabelText("Valor por sessão de Manutenção Método Fiaes (R$)"), { target: { value: "" } });
    fireEvent.click(d.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(savePkg).toHaveBeenCalledWith(expect.objectContaining({
      items: [{ serviceId: MF, sessions: 4, unitCents: null }, { serviceId: "22222222-2222-4222-8222-222222222222", sessions: 4, unitCents: 5_000 }] })));
  });

  it("valor por sessão inválido não salva", async () => {
    render(<ServicesPage tab="pacotes" services={ITEMS} packages={PACKS} professionals={PROS} canEdit initialOpen={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Combo Manutenção Método Fiaes" }));
    const d = within(screen.getByRole("dialog", { name: "Combo Manutenção Método Fiaes" }));
    fireEvent.change(d.getByLabelText("Valor por sessão de Corte Feminino (R$)"), { target: { value: "abc" } });
    fireEvent.click(d.getByRole("button", { name: "Salvar" }));
    expect(d.getByRole("alert").textContent).toMatch(/Valor por sessão/);
    expect(savePkg).not.toHaveBeenCalled();
  });

  it("abre o pacote pelo link (?pacote=) e Novo pacote: nome, serviço, sessões e preço; sem serviço não salva", async () => {
    render(<ServicesPage tab="pacotes" services={ITEMS} packages={PACKS} professionals={PROS} canEdit initialOpen={null} initialPackage={PK} />);
    expect(screen.getByRole("dialog", { name: "Combo Manutenção Método Fiaes" })).toBeTruthy();
    cleanup();
    render(<ServicesPage tab="pacotes" services={ITEMS} packages={[]} professionals={PROS} canEdit initialOpen={null} />);
    expect(screen.getByText(/Nenhum pacote cadastrado/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Novo pacote" }));
    const d = within(screen.getByRole("dialog", { name: "Novo pacote" }));
    fireEvent.change(d.getByLabelText("Nome"), { target: { value: "Combo 4 Cortes" } });
    fireEvent.click(d.getByRole("button", { name: "Criar pacote" }));
    expect(d.getByRole("alert").textContent).toMatch(/Escolha o serviço/);
    fireEvent.change(d.getByLabelText("Serviço 1"), { target: { value: "22222222-2222-4222-8222-222222222222" } });
    fireEvent.change(d.getByLabelText("Sessões de Corte Feminino"), { target: { value: "4" } });
    fireEvent.change(d.getByLabelText("Preço do pacote (R$)"), { target: { value: "900" } });
    fireEvent.click(d.getByRole("button", { name: "Criar pacote" }));
    await waitFor(() => expect(savePkg).toHaveBeenCalledWith({ id: null, name: "Combo 4 Cortes", priceCents: 90_000, validityDays: null, description: null, active: true,
      items: [{ serviceId: "22222222-2222-4222-8222-222222222222", sessions: 4, unitCents: null }] }));
  });

  it("atendente consulta o pacote sem campos", () => {
    render(<ServicesPage tab="pacotes" services={ITEMS} packages={PACKS} professionals={PROS} canEdit={false} initialOpen={null} />);
    expect(screen.queryByRole("button", { name: "Novo pacote" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Combo Manutenção Método Fiaes" }));
    const d = within(screen.getByRole("dialog", { name: "Combo Manutenção Método Fiaes" }));
    expect(d.getByText("4 manutenções completas.")).toBeTruthy();
    expect(d.queryByRole("textbox")).toBeNull();
  });
});

it("perfil só com estoque (M-5): só a aba Produtos, sem Serviços nem Pacotes", () => {
  render(<ServicesPage services={[]} professionals={[]} canEdit={false} initialOpen={null} tab="produtos" soProdutos produtos={<p>catálogo</p>} />);
  expect(screen.getByText("catálogo")).toBeTruthy();
  expect(screen.getByRole("link", { name: /Produtos/ })).toBeTruthy();
  expect(screen.queryByRole("link", { name: /^Serviços/ })).toBeNull();
  expect(screen.queryByRole("link", { name: /^Pacotes/ })).toBeNull();
});
