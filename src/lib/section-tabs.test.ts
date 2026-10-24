import { describe, expect, it } from "vitest";
import { clientesTabs, hojeTabs, relatoriosTabs } from "./section-tabs";
import { SYSTEM_PROFILES } from "./permissions";

const perfil = (k: string) => SYSTEM_PROFILES.find((p) => p.key === k)!.permissions;
const hrefs = (t: { href: string }[]) => t.map((x) => x.href);

describe("abas dentro das telas", () => {
  it("Hoje: Recepção (abre direto, dono 24/10) · Resumo · Ao vivo para quem atende; sem atendimento.ver, nada", () => {
    expect(hojeTabs(perfil("atendente")).map((t) => t.label)).toEqual(["Recepção", "Resumo", "Ao vivo"]);
    expect(hrefs(hojeTabs(perfil("atendente")))).toEqual(["/", "/?vista=resumo", "/ao-vivo"]);
    expect(hojeTabs(perfil("profissional"))).toEqual([]);
  });
  it("Clientes: Clientes · Com pacote (atendimento.ver) · Fidelidade (função ligada)", () => {
    expect(clientesTabs(perfil("gestao"), { fidelidadeOn: true }).map((t) => t.label)).toEqual(["Clientes", "Com pacote", "Fidelidade"]);
    expect(clientesTabs(perfil("gestao"), { fidelidadeOn: false }).map((t) => t.label)).toEqual(["Clientes", "Com pacote"]);
    expect(clientesTabs(["contatos.ver"], { fidelidadeOn: false }).map((t) => t.label)).toEqual(["Clientes"]);
    expect(clientesTabs(["atendimento.ver"], { fidelidadeOn: true })).toEqual([]);
  });
  it("Relatórios: todas as visões para a gestão; cada uma some sem a permissão", () => {
    const rel = (perms: readonly string[]) => relatoriosTabs(perms).map((t) => t.label);
    expect(rel(perfil("gestao"))).toEqual(["Visão geral", "Salão", "Análise", "Financeiro", "Comissão", "Jornada", "Relatórios do Avec"]);
    expect(rel(perfil("gestao").filter((p) => p !== "valores.ver"))).not.toContain("Financeiro");
    expect(rel(perfil("gestao").filter((p) => p !== "valores.ver"))).not.toContain("Relatórios do Avec");
    expect(rel(perfil("gestao").filter((p) => p !== "relatorios.equipe"))).not.toContain("Salão");
    expect(rel(perfil("gestao").filter((p) => p !== "jornada.ver"))).not.toContain("Jornada");
    expect(rel(["relatorios.ver"])).toEqual(["Visão geral", "Análise"]);
    for (const p of ["comissao.ver", "comissao.regras", "comissao.lancar", "comissao.pagar", "config.sistema"]) expect(rel(["relatorios.ver", p])).toContain("Comissão");
  });
});
