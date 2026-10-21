import { describe, expect, it } from "vitest";
import { activeNav, NAV, navFor } from "./nav";
import { SYSTEM_PROFILES } from "@/lib/permissions";

const perfil = (k: string) => SYSTEM_PROFILES.find((p) => p.key === k)!.permissions;
const keys = (xs: { key: string }[]) => xs.map((x) => x.key);
const all = (g: { dia: (typeof NAV)[number][]; gestao: (typeof NAV)[number][] }) => [...g.dia, ...g.gestao];

describe("navFor: itens e grupos por permissão (uma linha cada, sem subtópicos)", () => {
  it("gestão com o caixa no CRM vê os 5 do dia a dia e o grupo Gestão", () => {
    const g = navFor(perfil("gestao"), { caixaOn: true });
    expect(keys(g.dia)).toEqual(["hoje", "conversas", "agenda", "caixa", "clientes"]);
    expect(keys(g.gestao)).toEqual(["relatorios", "servicos", "config"]);
  });

  it("nenhum item tem subtópicos", () => {
    for (const it of NAV) expect(it).not.toHaveProperty("subs");
  });

  it("sem o caixa no CRM, o Caixa aponta para Fechar o dia e vai para o Mais do celular", () => {
    const c = navFor(perfil("gestao"), { caixaOn: false }).dia.find((i) => i.key === "caixa")!;
    expect(c).toMatchObject({ href: "/caixa/fechar-dia", mobile: "mais" });
    expect(navFor(perfil("gestao"), { caixaOn: true }).dia.find((i) => i.key === "caixa")).toMatchObject({ href: "/caixa", mobile: "bar" });
  });

  it("sem caixa.operar não há Caixa", () => {
    expect(keys(all(navFor(perfil("gestao").filter((p) => p !== "caixa.operar"), { caixaOn: true })))).not.toContain("caixa");
  });

  it("atendente: no grupo Gestão, Serviços e pacotes e Configurações (ela configura o dia a dia)", () => {
    expect(keys(navFor(perfil("atendente"), { caixaOn: true }).gestao)).toEqual(["servicos", "config"]);
  });

  it("atendente sem configurar o dia a dia: o grupo Gestão tem só Serviços e pacotes", () => {
    const g = navFor(perfil("atendente").filter((p) => !["config.diaadia", "config.marcadores", "config.fichas", "config.aviso_cliente"].includes(p)), { caixaOn: true });
    expect(keys(g.gestao)).toEqual(["servicos"]);
  });

  it("profissional: só Hoje, sem grupo Gestão", () => {
    const g = navFor(perfil("profissional"), { caixaOn: true });
    expect(keys(g.dia)).toEqual(["hoje"]);
    expect(g.gestao).toEqual([]);
  });

  it("rótulos dos itens", () => {
    expect(NAV.map((i) => i.label)).toEqual(["Hoje", "Conversas", "Agenda", "Caixa", "Clientes", "Relatórios", "Serviços e pacotes", "Configurações"]);
  });
});

describe("activeNav: o item aceso (pela rota mais específica)", () => {
  const items = all(navFor(perfil("gestao"), { caixaOn: true }));
  const on = (p: string) => activeNav(items, p).item;
  it("Hoje: / e /ao-vivo", () => { expect(on("/")).toBe("hoje"); expect(on("/ao-vivo")).toBe("hoje"); });
  it("Conversas: /atendimento, /atendimento/programadas, conversa aberta e /funil (Quadro)", () => {
    for (const p of ["/atendimento", "/atendimento/programadas", "/atendimento/abc", "/funil"]) expect(on(p)).toBe("conversas");
  });
  it("Agenda", () => expect(on("/agenda")).toBe("agenda"));
  it("Caixa: /caixa e as telas dele; /caixa/comissao é de Relatórios", () => {
    for (const p of ["/caixa", "/caixa/fechar-dia", "/caixa/fechamentos", "/caixa/equipe", "/caixa/pacotes"]) expect(on(p)).toBe("caixa");
    expect(on("/caixa/comissao")).toBe("relatorios");
  });
  it("Clientes: /contatos e a ficha", () => { expect(on("/contatos")).toBe("clientes"); expect(on("/contatos/abc")).toBe("clientes"); });
  it("Relatórios: /relatorios, /relatorios/avec e a Jornada", () => {
    for (const p of ["/relatorios", "/relatorios/avec", "/jornada"]) expect(on(p)).toBe("relatorios");
  });
  it("Serviços e pacotes e Configurações", () => { expect(on("/servicos")).toBe("servicos"); expect(on("/config/equipe")).toBe("config"); });
  it("/presenca não acende nada", () => expect(on("/presenca")).toBeNull());
});
