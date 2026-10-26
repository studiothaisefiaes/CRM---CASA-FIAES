import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { deals } from "@/server/db/schema";
import { recordInbound } from "@/server/domain/deals";
import { resetDb } from "../../../../test/db";
import { setSetting } from "../../../../test/agenda-fixtures";
import { chamar, chaveDe, pessoa } from "../../../../test/api-fixtures";
import { __zerarLimites } from "../limite";
import { RELATORIOS } from "./relatorios";
import { relatorio } from "./index";

beforeEach(async () => { await resetDb(); __zerarLimites(); });
const lead = async (phone: string) => {
  const r = await recordInbound({ channelId: null, externalId: `L-${phone}-${Math.random()}`, phoneRaw: phone, pushName: "Cliente Teste", body: "oi" });
  if (!("dealId" in r)) throw new Error("sem lead");
  return r.dealId;
};

describe("relatórios", () => {
  it("todo relatório registrado responde para a gestão com o período (ou 404 quando a função está desligada)", async () => {
    const k = await chaveDe((await pessoa("gestao")).id, ["ler"]);
    await lead("71999990201");
    const status: Record<string, number> = {};
    for (const r of RELATORIOS) {
      const res = await chamar(r, { chave: k });
      status[r.caminho] = res.status;
      if (res.status === 200) expect((res.json.periodo as { de: string }).de, r.caminho).toBeTruthy();
      else expect(res.json.erro, r.caminho).toMatch(/desligad/);
    }
    // Os que não dependem de função ligada respondem 200.
    for (const c of ["numeros", "funil", "parados", "pessoas", "salao", "financeiro", "retorno"]) expect(status[`/relatorios/${c}`], c).toBe(200);
  });

  it("chama a mesma função da tela: sem 'toda a equipe' só os números da própria pessoa; R$ só com ver valores", async () => {
    const ana = await pessoa(["relatorios.ver"], "Ana");
    const bia = await pessoa(["relatorios.ver"], "Bia");
    const a1 = await lead("71999990211");
    await lead("71999990212");
    await db.update(deals).set({ ownerId: ana.id }).where(eq(deals.id, a1));
    const ka = await chaveDe(ana.id, ["ler"]);
    // dono de outra pessoa é ignorado sem "toda a equipe": continua só a Ana.
    const n = await chamar(relatorio("numeros"), { chave: ka, query: { periodo: "mes", dono: bia.id } });
    expect(n.status).toBe(200);
    const d = n.json.dados as { leadsNovos: { atual: number }; vendas: { atual: { cents: number | null } }; ticketMedio: unknown };
    expect(d.leadsNovos.atual).toBe(1);
    expect(d.vendas.atual.cents).toBeNull();
    expect(d.ticketMedio).toBeNull();
    const g = await chamar(relatorio("numeros"), { chave: await chaveDe((await pessoa("gestao")).id, ["ler"]) });
    expect((g.json.dados as { leadsNovos: { atual: number } }).leadsNovos.atual).toBe(2);
    expect(n.json.periodo).toMatchObject({ rotulo: "Este mês", de: expect.stringMatching(/T00:00:00-03:00$/) });
  });

  it("os que pedem mais que Ver Relatórios dão 403 dizendo o que falta; Ver Relatórios em si é obrigatório", async () => {
    const k = await chaveDe((await pessoa(["relatorios.ver"])).id, ["ler"]);
    for (const c of ["pessoas", "salao", "financeiro", "vendas-e-cobrancas"]) {
      const r = await chamar(relatorio(c), { chave: k });
      expect(r.status, c).toBe(403);
      expect(r.json.erro, c).toMatch(/pede também/);
    }
    const semVer = await chaveDe((await pessoa(["atendimento.ver"])).id, ["ler"]);
    expect((await chamar(relatorio("numeros"), { chave: semVer })).status).toBe(403);
  });

  it("Salão e Financeiro aceitam de/ate (por dia) e recusam data inválida", async () => {
    const k = await chaveDe((await pessoa("gestao")).id, ["ler"]);
    const r = await chamar(relatorio("salao"), { chave: k, query: { de: "2026-10-01", ate: "2026-10-15" } });
    expect(r.status).toBe(200);
    expect(r.json.periodo).toMatchObject({ de: "2026-10-01", ate: "2026-10-15" });
    expect((await chamar(relatorio("financeiro"), { chave: k, query: { de: "01/10/2026" } })).json.erro).toMatch(/^de: /);
    await setSetting("relatorios_config", { ocupacao: true });
    expect((await chamar(relatorio("ocupacao"), { chave: k, query: { periodo: "7d" } })).status).toBe(200);
  });
});
