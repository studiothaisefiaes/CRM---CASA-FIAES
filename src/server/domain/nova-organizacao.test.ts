import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { contacts, dealEvents, deals, stages, tasks } from "../db/schema";
import { resetDb } from "../../../test/db";
import { applyNovaOrganizacao, planNovaOrganizacao, revertNovaOrganizacao, NOVA_ORG_REASON } from "./nova-organizacao";

const NOW = new Date("2026-10-17T12:00:00Z");
const T = (iso: string) => new Date(iso);
const stageId = async (key: string) => (await db.select({ id: stages.id }).from(stages).where(eq(stages.key, key)))[0].id;
const stageRow = async (key: string) => (await db.select().from(stages).where(eq(stages.key, key)))[0];
const dealRow = async (id: string) => (await db.select().from(deals).where(eq(deals.id, id)))[0];
const keyOf = async (id: string) => (await db.select({ k: stages.key }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, id)))[0].k;
let n = 0;
async function deal(key: string, patch: Partial<typeof deals.$inferInsert> = {}) {
  const [c] = await db.insert(contacts).values({ name: `Cliente ${++n} Teste`, phoneE164: `+55719900077${String(n).padStart(2, "0")}` }).returning();
  const [d] = await db.insert(deals).values({ contactId: c.id, stageId: await stageId(key), stageEnteredAt: T("2026-10-14T13:00:00Z"), createdAt: T("2026-10-10T13:00:00Z"), ...patch }).returning();
  return d.id;
}

/** O banco como o de produção antes (16/10): nomes antigos, Aguardando cliente e Fechado ativos. */
async function producaoAntes() {
  await db.update(stages).set({ name: "Em atendimento" }).where(eq(stages.key, "atendimento"));
  await db.update(stages).set({ name: "Orçamento enviado" }).where(eq(stages.key, "orcamento"));
  await db.update(stages).set({ name: "Retorno sugerido" }).where(eq(stages.key, "retorno"));
  await db.update(stages).set({ color: "#b8863f" }).where(eq(stages.key, "lead"));
  await db.update(stages).set({ name: "Aguardando cliente", active: true, attemptDays: [2, 4, 9] }).where(eq(stages.key, "followup_1"));
  await db.update(stages).set({ name: "Fechado", active: true }).where(eq(stages.key, "fechado"));
}

beforeEach(async () => { n = 0; await resetDb(); await producaoAntes(); });

describe("nova organização das etapas (16/10)", () => {
  it("o ensaio conta o que muda e não grava nada", async () => {
    await deal("followup_1", { followupAttempt: 2 });
    await deal("fechado", { closedAt: T("2026-10-12T15:00:00Z") });
    const plan = await planNovaOrganizacao();
    expect(plan.aguardando).toHaveLength(1);
    expect(plan.fechado).toHaveLength(1);
    expect(plan.stageChanges).toEqual(expect.arrayContaining([
      'Renomear "Em atendimento" → "Em conversa"', 'Renomear "Orçamento enviado" → "Orçamento"', 'Renomear "Retorno sugerido" → "Hora de voltar"',
      'Cor de "Novo contato": #b8863f → #a87a2c', 'Desativar "Aguardando cliente"', 'Desativar "Fechado"', "Dias das tentativas de Em conversa: os de Aguardando cliente (2, 4, 9)",
    ]));
    expect((await stageRow("atendimento")).name).toBe("Em atendimento");
    expect((await stageRow("followup_1")).active).toBe(true);
  });

  it("aplicar: Aguardando cliente → Em conversa mantendo as tentativas; Fechado → Atendida terminada e encerrada; etapas renomeadas e desativadas", async () => {
    const [t] = await db.insert(tasks).values({ contactId: (await db.insert(contacts).values({ name: "Tarefa Teste", phoneE164: "+5571990007799" }).returning())[0].id,
      kind: "proxima_acao", title: "Tentativa 2 de 3", dueAt: T("2026-10-18T13:00:00Z") }).returning();
    const aguardando = await deal("followup_1", { followupAttempt: 2, followupDueAt: T("2026-10-18T13:00:00Z"), followupTaskId: t.id });
    const fechado = await deal("fechado", { closedAt: T("2026-10-12T15:00:00Z"), valueCents: 18000 });
    const fechadoSemData = await deal("fechado", { stageEnteredAt: T("2026-10-11T15:00:00Z") });
    const encerradaAntes = await deal("fechado", { closedAt: T("2026-10-12T15:00:00Z"), conversationArchivedAt: T("2026-10-12T14:00:00Z") });
    const perdido = await deal("perdido", { closedAt: T("2026-10-12T15:00:00Z") });

    const r = await applyNovaOrganizacao(NOW);
    expect(r).toMatchObject({ aguardando: 1, fechado: 3 });

    expect(await keyOf(aguardando)).toBe("atendimento");
    expect(await dealRow(aguardando)).toMatchObject({ followupAttempt: 2, followupTaskId: t.id, stageEnteredAt: T("2026-10-14T13:00:00Z"), closedAt: null });
    expect(await keyOf(fechado)).toBe("atendida");
    expect(await dealRow(fechado)).toMatchObject({ closedAt: T("2026-10-12T15:00:00Z"), conversationArchivedAt: T("2026-10-12T15:00:00Z"), valueCents: 18000 });
    expect(await dealRow(fechadoSemData)).toMatchObject({ closedAt: T("2026-10-11T15:00:00Z"), conversationArchivedAt: T("2026-10-11T15:00:00Z") });
    expect((await dealRow(encerradaAntes)).conversationArchivedAt).toEqual(T("2026-10-12T14:00:00Z"));
    expect(await keyOf(perdido)).toBe("perdido");

    expect(await stageRow("atendimento")).toMatchObject({ name: "Em conversa", attemptDays: [2, 4, 9] });
    expect((await stageRow("orcamento")).name).toBe("Orçamento");
    expect((await stageRow("retorno")).name).toBe("Hora de voltar");
    expect((await stageRow("lead")).color).toBe("#a87a2c");
    expect((await stageRow("followup_1")).active).toBe(false);
    expect((await stageRow("fechado")).active).toBe(false);

    const ev = await db.select().from(dealEvents).where(and(eq(dealEvents.dealId, fechado), eq(dealEvents.type, "etapa_alterada")));
    expect(ev.map((e) => e.payload)).toEqual([{ de: "fechado", para: "atendida", motivo: NOVA_ORG_REASON }]);

    // o backup guarda o antes de cada etapa e de cada conversa movida
    expect(r.backup.stages.find((s) => s.key === "atendimento")).toMatchObject({ name: "Em atendimento" });
    expect(r.backup.deals.find((d) => d.id === fechado)).toMatchObject({ stageKey: "fechado", conversationArchivedAt: null });

    // rodar de novo não muda mais nada
    const again = await applyNovaOrganizacao(NOW);
    expect(again).toMatchObject({ aguardando: 0, fechado: 0, stageChanges: [] });
  });

  it("conversa não-cliente (arquivada) guardada em Aguardando/Fechado também muda, para o Desfazer não cair numa etapa desligada", async () => {
    const naoCliente = await deal("followup_1", { archivedAt: T("2026-10-12T15:00:00Z"), archivedStageId: await stageId("followup_1") });
    await applyNovaOrganizacao(NOW);
    expect(await keyOf(naoCliente)).toBe("atendimento");
    expect((await dealRow(naoCliente)).archivedStageId).toBe(await stageId("atendimento"));
  });

  it("reverter com o backup volta tudo; conversa que a equipe já mexeu depois fica como está", async () => {
    const aguardando = await deal("followup_1", { followupAttempt: 1 });
    const fechado = await deal("fechado", { closedAt: T("2026-10-12T15:00:00Z") });
    const mexida = await deal("fechado", { closedAt: T("2026-10-12T15:00:00Z") });
    const { backup } = await applyNovaOrganizacao(NOW);
    await db.update(deals).set({ stageId: await stageId("agendado") }).where(eq(deals.id, mexida));

    const r = await revertNovaOrganizacao(backup);
    expect(r).toMatchObject({ deals: 2, skipped: [mexida] });
    expect(await keyOf(aguardando)).toBe("followup_1");
    expect(await keyOf(fechado)).toBe("fechado");
    expect(await dealRow(fechado)).toMatchObject({ conversationArchivedAt: null, closedAt: T("2026-10-12T15:00:00Z") });
    expect(await keyOf(mexida)).toBe("agendado");
    expect(await stageRow("atendimento")).toMatchObject({ name: "Em atendimento", attemptDays: null });
    expect(await stageRow("followup_1")).toMatchObject({ active: true });
    expect(await stageRow("fechado")).toMatchObject({ active: true });
    expect((await stageRow("lead")).color).toBe("#b8863f");
    const left = await db.execute(sql`select count(*)::int as n from deal_events where type = 'etapa_alterada' and payload->>'motivo' = ${NOVA_ORG_REASON}`);
    expect((left.rows[0] as { n: number }).n).toBe(1); // só o da conversa que ficou
  });
});

it("se gravar o backup falhar, nada é aplicado", async () => {
  const id = await deal("fechado", { closedAt: T("2026-10-12T15:00:00Z") });
  await expect(applyNovaOrganizacao(NOW, { beforeCommit: async () => { throw new Error("disco cheio"); } })).rejects.toThrow("disco cheio");
  expect(await keyOf(id)).toBe("fechado");
  expect((await stageRow("atendimento")).name).toBe("Em atendimento");
});
