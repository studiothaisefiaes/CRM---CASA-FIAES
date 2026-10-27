import { describe, expect, it } from "vitest";
import {
  GESTAO_REQUIRED, ONE_TIME_GRANTS, PERM_GROUP, PERM_HELP, PERM_LABEL, PROFILE_ABOUT, SYSTEM_PROFILES, canConfigure, canSeeAvecReports, defaultReportTab,
  firstAllowedPath, isProOnly, isReportsOnly,
} from "./permissions";
import { navFor } from "@/components/shell/nav";
import { caixaLeituraLinks } from "./section-tabs";

const contador = () => SYSTEM_PROFILES.find((p) => p.key === "contador")!.permissions;
const keys = (g: { dia: { key: string }[]; gestao: { key: string }[] }) => [...g.dia, ...g.gestao].map((i) => i.key);

/** Pedido do dono (26/10): perfil do contador, só leitura do dinheiro e do fiscal. */
describe("perfil Contador", () => {
  it("existe como perfil de sistema, com exatamente as permissões de leitura do dinheiro e do fiscal", () => {
    const p = SYSTEM_PROFILES.find((x) => x.key === "contador")!;
    expect(p.name).toBe("Contador");
    expect([...p.permissions].sort()).toEqual([
      "caixa.dinheiro", "caixa.outros", "comissao.ver", "nota.ver", "relatorios.equipe", "relatorios.excecoes", "relatorios.exportar", "relatorios.ver", "valores.ver",
    ]);
  });

  it("nenhuma permissão de escrita, de conversa, de cliente, de agenda, de configuração, de equipe ou da API", () => {
    const perms = contador();
    for (const p of perms) expect(p).not.toMatch(/^(atendimento|distribuicao|alertas|quadro|jornada|contatos|mensagem|conversa|cliente|agenda|config|equipe|setores|horario|virada|biblioteca|fichas|fotos|fidelidade|servicos|estoque|pro|api|financeiro)\./);
    for (const w of ["caixa.operar", "caixa.gerir", "caixa.taxas", "caixa.cancelar", "comissao.lancar", "comissao.pagar", "comissao.regras", "nota.emitir", "nota.cancelar", "nota.resolver", "nota.configurar"]) {
      expect(perms).not.toContain(w);
    }
    expect(canConfigure(perms)).toBe(false);
    expect(isProOnly(perms)).toBe(false);
  });

  it("não vê os relatórios do Avec (o envio mexe em agenda, contatos e pacotes): pede a permissão própria relatorios.avec", () => {
    expect(canSeeAvecReports(contador())).toBe(false);
    expect(canSeeAvecReports(["relatorios.ver", "relatorios.equipe", "valores.ver"])).toBe(false);
    expect(canSeeAvecReports(["relatorios.ver", "relatorios.equipe", "valores.ver", "relatorios.avec"])).toBe(true);
    expect(GESTAO_REQUIRED).toContain("relatorios.avec");
    expect(PERM_GROUP["relatorios.avec"]).toBe("Relatórios");
    expect(PERM_LABEL["relatorios.avec"]).toBe("Ver e enviar os relatórios do Avec");
    expect(PERM_HELP["relatorios.avec"]).toMatch(/\.$/);
    expect(ONE_TIME_GRANTS.some((g) => (g.profile as string) === "contador")).toBe(false);
  });

  it("explicação do perfil no editor de perfis", () => {
    expect(PROFILE_ABOUT.contador).toMatch(/contador/i);
    expect(PROFILE_ABOUT.contador).toMatch(/Financeiro/);
  });

  it("entra em Relatórios › Financeiro; sem permissão de uma tela, volta para Relatórios (não para o Hoje)", () => {
    expect(isReportsOnly(contador())).toBe(true);
    expect(firstAllowedPath(contador())).toBe("/relatorios");
    expect(defaultReportTab(contador())).toBe("financeiro");
    // Quem atende ou opera o caixa continua no Hoje, e a aba padrão de Relatórios continua a Visão geral.
    const gestao = SYSTEM_PROFILES.find((p) => p.key === "gestao")!.permissions;
    expect(isReportsOnly(gestao)).toBe(false);
    expect(firstAllowedPath(gestao)).toBe("/");
    expect(defaultReportTab(gestao)).toBe("visao");
    expect(isReportsOnly(["relatorios.ver", "caixa.operar"])).toBe(false);
    expect(defaultReportTab(["relatorios.ver"])).toBe("visao");
  });

  it("menu: só Relatórios (sem Hoje, Conversas, Agenda, Caixa, Clientes, Serviços e Configurações), na barra do celular", () => {
    const g = navFor(contador(), { caixaOn: true });
    expect(keys(g)).toEqual(["relatorios"]);
    expect(g.gestao[0].mobile).toBe("bar");
    // Caixas da equipe e Fechamentos acendem Relatórios para quem não opera o caixa.
    expect(g.gestao[0].match).toEqual(expect.arrayContaining(["/caixa/equipe", "/caixa/fechamentos"]));
    // Quem opera o caixa continua com o item Caixa, e Relatórios não toma as rotas do Caixa.
    const gestao = navFor(SYSTEM_PROFILES.find((p) => p.key === "gestao")!.permissions, { caixaOn: true });
    expect(gestao.gestao.find((i) => i.key === "relatorios")!.match).not.toContain("/caixa/equipe");
  });

  it("os caixas e fechamentos da equipe abrem por Relatórios, só para ver", () => {
    expect(caixaLeituraLinks(contador())).toEqual([
      { key: "caixas", label: "Caixas da equipe", href: "/caixa/equipe" },
      { key: "fechamentos", label: "Fechamentos de caixa", href: "/caixa/fechamentos" },
    ]);
    // Quem opera o caixa vê o histórico dentro de Fechar caixa / dia.
    expect(caixaLeituraLinks(["caixa.operar", "caixa.outros"]).find((l) => l.key === "fechamentos")!.href).toBe("/caixa/fechar-dia#historico");
    expect(caixaLeituraLinks(["relatorios.ver"])).toEqual([]);
  });
});
