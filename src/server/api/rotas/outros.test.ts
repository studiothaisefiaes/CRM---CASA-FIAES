import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { alerts, deals, tasks } from "@/server/db/schema";
import { recordInbound } from "@/server/domain/deals";
import { setStrictScope } from "@/server/domain/deal-scope";
import { resetDb } from "../../../../test/db";
import { chamar, chaveDe, pessoa } from "../../../../test/api-fixtures";
import { __zerarLimites } from "../limite";
import { isoBahia } from "../rota";
import { listarEtapas } from "./funil";
import { concluirTarefa, criarTarefa, listarTarefas } from "./tarefas";
import { alterarResposta, criarResposta, listarRespostas } from "./respostas";
import { listarAvisos } from "./avisos";

beforeEach(async () => { await resetDb(); __zerarLimites(); });
const lead = async (phone: string) => {
  const r = await recordInbound({ channelId: null, externalId: `L-${phone}-${Math.random()}`, phoneRaw: phone, pushName: "Cliente Teste", body: "oi" });
  if (!("dealId" in r)) throw new Error("sem lead");
  return r.dealId;
};
const daqui = (h: number) => isoBahia(new Date(Date.now() + h * 3_600_000));

describe("funil", () => {
  it("etapas ativas na ordem; as que pedem dados vêm com muda_direto false", async () => {
    const k = await chaveDe((await pessoa(["quadro.ver"])).id, ["ler"]);
    const r = await chamar(listarEtapas, { chave: k });
    const etapas = r.json.dados as { chave: string; muda_direto: boolean; posicao: number }[];
    expect(etapas.map((e) => e.posicao)).toEqual([...etapas.map((e) => e.posicao)].sort((a, b) => a - b));
    expect(etapas.find((e) => e.chave === "agendado")?.muda_direto).toBe(false);
    expect(etapas.find((e) => e.chave === "lead")?.muda_direto).toBe(true);
    expect(etapas.some((e) => e.chave === "fechado")).toBe(false);
  });
});

describe("tarefas", () => {
  it("cria a próxima ação pelo setNextAction (substitui a anterior), lista as minhas e conclui", async () => {
    const ana = await pessoa("atendente", "Ana");
    const k = await chaveDe(ana.id, ["ler", "escrever"]);
    const id = await lead("71999990101");
    await db.update(deals).set({ ownerId: ana.id }).where(eq(deals.id, id));
    const t1 = await chamar(criarTarefa, { chave: k, body: { conversa_id: id, titulo: "Mandar orçamento", vence_em: daqui(5) } });
    expect(t1.status).toBe(201);
    expect(t1.json.dados).toMatchObject({ titulo: "Mandar orçamento", tipo: "proxima_acao", responsavel: { id: ana.id }, conversa_id: id });
    const t2 = await chamar(criarTarefa, { chave: k, body: { conversa_id: id, titulo: "Ligar", vence_em: daqui(6) } });
    const abertas = await chamar(listarTarefas, { chave: k });
    expect((abertas.json.dados as { id: string }[]).map((t) => t.id)).toEqual([(t2.json.dados as { id: string }).id]);
    expect((await chamar(criarTarefa, { chave: k, body: { conversa_id: id, titulo: "Passado", vence_em: daqui(-5) } })).json.erro).toMatch(/já passou/);

    const t2id = (t2.json.dados as { id: string }).id;
    const c = await chamar(concluirTarefa, { chave: k, params: { id: t2id }, body: { concluida: true } });
    expect((c.json.dados as { concluida_em: string | null }).concluida_em).toMatch(/-03:00$/);
    expect((await chamar(concluirTarefa, { chave: k, params: { id: t2id }, body: { concluida: true } })).status).toBe(200);
    expect((await chamar(listarTarefas, { chave: k })).json.dados).toEqual([]);
    expect((await chamar(listarTarefas, { chave: k, query: { abertas: "false" } })).json.dados).toHaveLength(2);
  });

  it("tarefas de outras pessoas e sem responsável só com Ver conversas de todas; concluir respeita o escopo da conversa", async () => {
    const ana = await pessoa("atendente", "Ana");
    const bia = await pessoa("atendente", "Bia");
    const gestao = await pessoa("gestao");
    const id = await lead("71999990102");
    await db.update(deals).set({ ownerId: bia.id }).where(eq(deals.id, id));
    const [t] = await db.insert(tasks).values({ dealId: id, contactId: (await db.select().from(deals).where(eq(deals.id, id)))[0].contactId, kind: "geral", title: "Da Bia", dueAt: new Date(), assigneeId: bia.id }).returning();
    const ka = await chaveDe(ana.id);
    expect((await chamar(listarTarefas, { chave: ka, query: { responsavel: bia.id } })).status).toBe(403);
    expect((await chamar(listarTarefas, { chave: ka, query: { responsavel: "sem" } })).status).toBe(403);
    const kg = await chaveDe(gestao.id);
    expect((await chamar(listarTarefas, { chave: kg, query: { responsavel: bia.id } })).json.dados).toMatchObject([{ id: t.id }]);
    await setStrictScope(true, gestao.id);
    expect((await chamar(concluirTarefa, { chave: ka, params: { id: t.id }, body: { concluida: true } })).status).toBe(403);
  });
});

describe("respostas prontas", () => {
  it("a atendente cria e edita a sua; universal e as de todas só a gestão", async () => {
    const ana = await pessoa("atendente", "Ana");
    const k = await chaveDe(ana.id, ["ler", "escrever"]);
    const r = await chamar(criarResposta, { chave: k, body: { atalho: "/Bom Dia", texto: "Bom dia! Tudo bem?" } });
    expect(r.status).toBe(201);
    const id = (r.json.dados as { id: string }).id;
    expect(r.json.dados).toMatchObject({ atalho: "bom-dia", minha: true });
    expect((await chamar(criarResposta, { chave: k, body: { atalho: "geral", texto: "x", para: "todas" } })).status).toBe(403);
    expect((await chamar(alterarResposta, { chave: k, params: { id }, body: { texto: "Bom dia, flor!" } })).json.dados).toMatchObject({ texto: "Bom dia, flor!", ativa: true });
    expect((await chamar(alterarResposta, { chave: k, params: { id }, body: { para: "todas" } })).status).toBe(403);
    // Texto + "para todas" sem ser da gestão: recusa antes de gravar o texto.
    expect((await chamar(alterarResposta, { chave: k, params: { id }, body: { texto: "Não era para mudar", para: "todas" } })).status).toBe(403);
    expect(((await chamar(listarRespostas, { chave: k })).json.dados as { id: string; texto: string }[]).find((x) => x.id === id)?.texto).toBe("Bom dia, flor!");

    const bia = await chaveDe((await pessoa("atendente", "Bia")).id);
    // (o seed já traz respostas universais; aqui só a de teste importa)
    const daBia = async () => ((await chamar(listarRespostas, { chave: bia })).json.dados as { id: string; minha: boolean }[]).filter((x) => x.id === id);
    expect(await daBia()).toEqual([]);
    expect((await chamar(alterarResposta, { chave: bia, params: { id }, body: { texto: "invadir" } })).status).toBe(404);

    const g = await chaveDe((await pessoa("gestao")).id);
    expect((await chamar(alterarResposta, { chave: g, params: { id }, body: { para: "todas" } })).json.dados).toMatchObject({ minha: false });
    expect(await daBia()).toMatchObject([{ id, atalho: "bom-dia", minha: false }]);
    expect((await chamar(alterarResposta, { chave: g, params: { id }, body: { ativa: false } })).json.dados).toMatchObject({ ativa: false });
    expect(await daBia()).toEqual([]);
  });
});

describe("avisos", () => {
  it("os do sino da pessoa da chave (e os da gestão para quem recebe escaladas)", async () => {
    const ana = await pessoa("atendente", "Ana");
    const gestao = await pessoa("gestao");
    const id = await lead("71999990103");
    await db.insert(alerts).values([
      { dealId: id, userId: ana.id, type: "mencao", message: "Bia te chamou", dedupeKey: "t1" },
      { dealId: id, audience: "gestao", type: "sem_resposta", message: "Esperando há 30 min", dedupeKey: "t2" },
    ]);
    // (A mensagem da cliente também avisa a equipe: "Fulana escreveu"; aqui só os dois de teste importam.)
    const msgs = async (userId: string) => ((await chamar(listarAvisos, { chave: await chaveDe(userId, ["ler"]) })).json.dados as { mensagem: string; para_mim: boolean; conversa_id: string }[]);
    const a = await msgs(ana.id);
    expect(a.find((x) => x.mensagem === "Bia te chamou")).toMatchObject({ para_mim: true, conversa_id: id });
    expect(a.some((x) => x.mensagem === "Esperando há 30 min")).toBe(false);
    const g = await msgs(gestao.id);
    expect(g.some((x) => x.mensagem === "Esperando há 30 min")).toBe(true);
    expect(g.some((x) => x.mensagem === "Bia te chamou")).toBe(false);
  });
});
