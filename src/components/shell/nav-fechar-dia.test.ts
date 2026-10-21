import { describe, expect, it } from "vitest";
import { activeNav, NAV, navFor } from "./nav";
import { SYSTEM_PROFILES } from "@/lib/permissions";
import { caixaTabs } from "@/lib/section-tabs";

const perfil = (k: string) => SYSTEM_PROFILES.find((p) => p.key === k)!.permissions;
const all = (g: { dia: (typeof NAV)[number][]; gestao: (typeof NAV)[number][] }) => [...g.dia, ...g.gestao];

describe("Caixa › Fechar o dia (abas dentro do Caixa)", () => {
  it("com o caixa no CRM: Comandas, Fechar o dia, Fechamentos, Caixas da equipe e Pacotes das clientes", () => {
    expect(caixaTabs(perfil("gestao"), { caixaOn: true }).map((t) => t.href)).toEqual(["/caixa", "/caixa/fechar-dia", "/caixa/fechamentos", "/caixa/equipe", "/caixa/pacotes"]);
  });
  it("com o caixa no Avec: só Fechar o dia (e os Pacotes das clientes, para a gestão)", () => {
    expect(caixaTabs(perfil("gestao"), { caixaOn: false }).map((t) => t.href)).toEqual(["/caixa/fechar-dia", "/caixa/pacotes"]);
  });
  it("Caixas da equipe pede caixa.outros; Pacotes, config.sistema ou caixa.gerir; a Comissão não é do Caixa", () => {
    const hrefs = (p: string[]) => caixaTabs(p, { caixaOn: true }).map((t) => t.href);
    expect(hrefs(["caixa.operar", "caixa.gerir"])).not.toContain("/caixa/equipe");
    expect(hrefs(["caixa.operar", "caixa.outros"])).toContain("/caixa/equipe");
    expect(hrefs(["caixa.operar"])).not.toContain("/caixa/pacotes");
    expect(hrefs(["caixa.operar", "config.sistema"])).toContain("/caixa/pacotes");
    expect(hrefs(["caixa.operar", "comissao.ver"])).not.toContain("/caixa/comissao");
  });
  it("sem caixa.operar não há abas; /caixa/fechar-dia acende Caixa no menu", () => {
    expect(caixaTabs(perfil("gestao").filter((p) => p !== "caixa.operar"), { caixaOn: true })).toEqual([]);
    expect(activeNav(all(navFor(perfil("gestao"), { caixaOn: false })), "/caixa/fechar-dia").item).toBe("caixa");
  });
});
