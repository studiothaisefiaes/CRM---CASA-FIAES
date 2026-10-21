// @vitest-environment jsdom
import { it, expect, vi, afterEach, describe } from "vitest";
import { render, cleanup, within, act, fireEvent, screen } from "@testing-library/react";
import { SYSTEM_PROFILES } from "@/lib/permissions";

let path = "/funil";
let search = "";
vi.mock("next/navigation", () => ({
  usePathname: () => path,
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("./use-live-alerts", () => ({ useLiveAlerts: (a: unknown[]) => ({ alerts: a, reload: vi.fn() }) }));
vi.mock("./alerts-bell", () => ({ AlertsBell: () => null }));
vi.mock("./push-cleanup", () => ({ logoutAction: vi.fn() }));
vi.mock("./availability-menu", () => ({ AvailabilityMenu: () => null, MobileAvailability: () => null }));
vi.mock("./sound-hint", () => ({ SoundUnlockHint: () => null }));
window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

import { Sidebar } from "./sidebar";
import { setMenuCollapsedElsewhere, setMenuOpenOnWorkspace } from "./sidebar-state";

afterEach(() => { cleanup(); path = "/funil"; search = ""; act(() => { setMenuOpenOnWorkspace(false); setMenuCollapsedElsewhere(false); }); });

const perms = (k: string) => SYSTEM_PROFILES.find((p) => p.key === k)!.permissions;
const user = (k: string, extra: { perms?: readonly string[] } = {}) => ({ name: "Sara Lima", profileName: k, perms: extra.perms ?? perms(k), availability: "disponivel" });
const desktop = () => document.querySelector("aside") as HTMLElement;
const labels = (root: HTMLElement) => within(root).getAllByRole("link").map((a) => a.textContent?.trim());

describe("menu lateral do computador", () => {
  it("aberto em /funil: Conversas acesa, sem subtópicos (uma linha por item); depois o grupo Gestão", () => {
    act(() => setMenuOpenOnWorkspace(true));
    render(<Sidebar user={user("gestao")} alerts={[]} caixaOn />);
    const nav = within(desktop()).getByRole("navigation", { name: "Principal" });
    const current = within(nav).getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page").map((a) => a.textContent?.trim());
    expect(current).toEqual(["Conversas"]);
    expect(within(nav).queryByRole("list")).toBeNull();
    expect(labels(nav)).toEqual(["Hoje", "Conversas", "Agenda", "Caixa", "Clientes", "Relatórios", "Serviços e pacotes", "Configurações"]);
    const titulo = within(nav).getByText("Gestão");
    expect(titulo.className).not.toMatch(/sr-only/);
    // "Gestão" vem antes de Relatórios
    const rel = within(nav).getByRole("link", { name: "Relatórios" });
    expect(titulo.compareDocumentPosition(rel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("item sem subtópicos: o próprio item é a página", () => {
    path = "/config";
    render(<Sidebar user={user("gestao")} alerts={[]} caixaOn />);
    const nav = within(desktop()).getByRole("navigation", { name: "Principal" });
    expect(within(nav).getByRole("link", { name: "Configurações" }).getAttribute("aria-current")).toBe("page");
  });

  it.each([["/", "Hoje"], ["/ao-vivo", "Hoje"], ["/caixa/comissao", "Relatórios"], ["/jornada", "Relatórios"], ["/caixa/fechamentos", "Caixa"], ["/contatos", "Clientes"]])("%s acende só %s", (p, item) => {
    path = p; search = "vista=pacote";
    render(<Sidebar user={user("gestao")} alerts={[]} caixaOn />);
    const nav = within(desktop()).getByRole("navigation", { name: "Principal" });
    expect(within(nav).getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page").map((a) => a.textContent?.trim())).toEqual([item]);
    expect(within(nav).queryByRole("list")).toBeNull();
  });

  it("recolhido: só ícones, sem subtópicos, sem título Gestão visível, com um separador antes de Relatórios", () => {
    render(<Sidebar user={user("gestao")} alerts={[]} caixaOn />); // /funil nasce recolhido
    const nav = within(desktop()).getByRole("navigation", { name: "Principal" });
    expect(within(nav).queryByRole("list")).toBeNull();
    expect(labels(nav)).toEqual(["Hoje", "Conversas", "Agenda", "Caixa", "Clientes", "Relatórios", "Serviços e pacotes", "Configurações"]);
    const g = within(nav).getByText("Gestão");
    expect(g.className).toMatch(/sr-only/);
    const sep = within(nav).getByRole("separator");
    const rel = within(nav).getByRole("link", { name: "Relatórios" });
    expect(sep.compareDocumentPosition(rel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("r66 #13: recolhido, o nome do item aparece ao passar o mouse e ao focar (e continua para o leitor de tela)", () => {
    render(<Sidebar user={user("gestao")} alerts={[]} caixaOn />);
    const nav = within(desktop()).getByRole("navigation", { name: "Principal" });
    const conv = within(nav).getByRole("link", { name: "Conversas" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.mouseEnter(conv);
    expect(screen.getByRole("tooltip").textContent).toBe("Conversas");
    fireEvent.mouseLeave(conv);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(within(nav).getByRole("link", { name: "Agenda" }));
    expect(screen.getByRole("tooltip").textContent).toBe("Agenda");
  });

  it("atendente: sem Relatórios; Gestão com Serviços e pacotes e Configurações (ela configura o dia a dia)", () => {
    path = "/agenda";
    render(<Sidebar user={user("atendente")} alerts={[]} />);
    const nav = within(desktop()).getByRole("navigation", { name: "Principal" });
    expect(within(nav).queryByRole("link", { name: "Relatórios" })).toBeNull();
    expect(within(nav).getByText("Gestão")).toBeTruthy();
    expect(within(nav).getByRole("link", { name: "Serviços e pacotes" })).toBeTruthy();
  });

  it("sem nada da Gestão, o título Gestão não aparece", () => {
    path = "/agenda";
    const p = perms("atendente").filter((x) => !["config.diaadia", "config.marcadores", "config.fichas", "config.aviso_cliente", "atendimento.ver"].includes(x));
    render(<Sidebar user={user("atendente", { perms: p })} alerts={[]} />);
    const nav = within(desktop()).getByRole("navigation", { name: "Principal" });
    expect(within(nav).queryByText("Gestão")).toBeNull();
    expect(within(nav).queryByRole("separator")).toBeNull();
  });
});

describe("celular: barra de baixo e Mais", () => {
  const bar = () => document.querySelector("nav.lg\\:hidden") as HTMLElement | null;
  const maisBtn = () => within(bar()!).getByRole("button", { name: "Mais" });

  it("a barra tem Hoje, Conversas, Agenda, Caixa (com o caixa no CRM) e Mais", () => {
    path = "/agenda";
    render(<Sidebar user={user("gestao")} alerts={[]} caixaOn />);
    expect([...labels(bar()!), maisBtn().textContent]).toEqual(["Hoje", "Conversas", "Agenda", "Caixa", "Mais"]);
  });

  it("sem o caixa no CRM a barra fica com Hoje, Conversas, Agenda e Mais", () => {
    path = "/agenda";
    render(<Sidebar user={user("gestao")} alerts={[]} />);
    expect(labels(bar()!)).toEqual(["Hoje", "Conversas", "Agenda"]);
  });

  it("o Mais lista Clientes, o título Gestão, Relatórios, Serviços e pacotes, Configurações e Sair, nesta ordem", () => {
    path = "/agenda";
    render(<Sidebar user={user("gestao")} alerts={[]} caixaOn />);
    fireEvent.click(maisBtn());
    const sheet = screen.getByRole("dialog", { name: "Mais" });
    const items = [...sheet.querySelectorAll("a, button, [data-group-title]")]
      .filter((el) => !el.hasAttribute("data-close") && el.getAttribute("aria-label") !== "Fechar")
      .map((el) => el.textContent?.trim());
    expect(items).toEqual(["Clientes", "Gestão", "Relatórios", "Serviços e pacotes", "Configurações", "Sair"]);
    expect(within(sheet).queryByText("Com pacote")).toBeNull(); // subtópicos não aparecem no celular
  });

  it.each(["/contatos", "/relatorios", "/servicos", "/config/equipe", "/jornada"])("Mais fica aceso em %s", (p) => {
    path = p;
    render(<Sidebar user={user("gestao")} alerts={[]} caixaOn />);
    expect(maisBtn().className).toMatch(/text-ink/);
    expect(within(bar()!).getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page")).toEqual([]);
  });

  it("em /funil Conversas fica acesa, e o Mais não", () => {
    path = "/funil";
    render(<Sidebar user={user("gestao")} alerts={[]} caixaOn />);
    expect(within(bar()!).getByRole("link", { name: "Conversas" }).getAttribute("aria-current")).toBe("page");
    expect(maisBtn().className).not.toMatch(/text-ink/);
  });

  it("conversa em tela cheia (/atendimento/<id>): sem barra de cima e sem barra de baixo", () => {
    path = "/atendimento/7d3f2a10-1b2c-4d5e-8f90-a1b2c3d4e5f6";
    render(<Sidebar user={user("gestao")} alerts={[]} caixaOn />);
    expect(bar()).toBeNull();
    expect(document.querySelector("header.lg\\:hidden")).toBeNull();
  });
});
