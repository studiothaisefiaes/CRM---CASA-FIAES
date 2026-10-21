import { beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { db } from "../db";
import { automations, contacts, deals, profiles, stages, users } from "../db/schema";
import { seed } from "../db/seed";
import { resetDb } from "../../../test/db";
import { etapasAntigasAtivas } from "../../../test/legacy-stages"; // histórico de antes da nova organização (16/10)
import { permsFor } from "../../../test/perms";
import { getBoard } from "../queries/board";
import { deleteAutomation, moveStage, saveAutomation } from "./config";
import { stageByKind } from "./deals";
import { createStage, deleteStage } from "./stage-admin";

beforeEach(async () => { await resetDb(); await etapasAntigasAtivas(); });
const gestor = async () => (await db.insert(users).values({ name: "Gestora Teste", email: "g@teste.local", role: "gestor" }).returning())[0].id;
const espera = async () => (await db.select().from(automations).where(eq(automations.key, "atendimento_3min")))[0];
const stagesOf = (a: { conditions: unknown }) => (a.conditions as { stages: string[] }[])[0].stages;

describe("Configurações › Etapas: criar e apagar (Lote 4)", () => {
  it("etapa nova recebe os avisos de espera e o seed não tira; copia prazo e cor; fica depois da principal do tipo", async () => {
    const g = await gestor();
    const principal = await stageByKind("followup");
    const { key } = await createStage({ name: "Aguardando foto", kind: "followup", afterId: null, visibleProfileIds: null }, g);
    const s = (await db.select().from(stages).where(eq(stages.key, key)))[0];
    expect(s).toMatchObject({ name: "Aguardando foto", kind: "followup", slaMinutes: principal.slaMinutes, color: principal.color, active: true, visibleProfileIds: null });
    expect(s.position).toBeGreaterThan(principal.position);
    expect((await stageByKind("followup")).id).toBe(principal.id); // a principal continua sendo a que o sistema usa
    expect(stagesOf(await espera())).toContain(key);
    expect((await espera()).version).toBe(2);
    await seed(db); // o próximo deploy
    expect(stagesOf(await espera())).toContain(key);
  });

  it("nome repetido é recusado", async () => {
    const g = await gestor();
    await expect(createStage({ name: "em conversa", kind: "atendimento", afterId: null, visibleProfileIds: null }, g)).rejects.toThrow('Já existe a etapa "em conversa"');
  });

  it("quem vê: a coluna some do Quadro da atendente, aparece para a recepção e para a gestão", async () => {
    const g = await gestor();
    const [recepcao] = await db.select().from(profiles).where(eq(profiles.key, "recepcao"));
    const [atendente] = await db.select().from(profiles).where(eq(profiles.key, "atendente"));
    const { id } = await createStage({ name: "Pós-venda", kind: "atendido", afterId: null, visibleProfileIds: [recepcao.id] }, g);
    const ana = { id: g, perms: permsFor("atendente"), profileId: atendente.id };
    expect((await getBoard({}, ana)).map((s) => s.id)).not.toContain(id);
    expect((await getBoard({}, { ...ana, profileId: recepcao.id })).map((s) => s.id)).toContain(id);
    expect((await getBoard({}, { id: g, perms: permsFor("gestor"), profileId: null })).map((s) => s.id)).toContain(id);
  });

  it("não apaga a única etapa do tipo nem etapa com conversa aberta; com histórico, desativa", async () => {
    const g = await gestor();
    await expect(deleteStage((await stageByKind("agendado")).id, g)).rejects.toThrow(/única etapa do tipo Agendado/);
    const { id } = await createStage({ name: "Agendado VIP", kind: "agendado", afterId: null, visibleProfileIds: null }, g);
    const [c] = await db.insert(contacts).values({ name: "Cliente Teste", phoneE164: "+5571990000201" }).returning();
    const [d] = await db.insert(deals).values({ contactId: c.id, stageId: id }).returning();
    await expect(deleteStage(id, g)).rejects.toThrow('1 conversa está em "Agendado VIP"');
    await db.update(deals).set({ closedAt: new Date() }).where(eq(deals.id, d.id));
    expect(await deleteStage(id, g)).toEqual({ mode: "desativada" });
    expect((await db.select().from(stages).where(eq(stages.id, id)))[0].active).toBe(false);
  });

  it("sem histórico some de vez e sai das automações; automação que move para ela impede", async () => {
    const g = await gestor();
    const { id, key } = await createStage({ name: "Teste vazia", kind: "atendimento", afterId: null, visibleProfileIds: null }, g);
    const auto = await saveAutomation(null, { name: "Move para teste", enabled: false, trigger: { type: "parado_dias", days: 3 }, conditions: [], actions: [{ type: "mover_para_etapa", stage: key }] }, g);
    await expect(deleteStage(id, g)).rejects.toThrow('move conversas para "Teste vazia"');
    await deleteAutomation(auto, g);
    expect(await deleteStage(id, g)).toEqual({ mode: "apagada" });
    expect(await db.select().from(stages).where(eq(stages.id, id))).toEqual([]);
    expect(stagesOf(await espera())).not.toContain(key);
  });

  it("a etapa extra não passa à frente da principal do mesmo tipo", async () => {
    const g = await gestor();
    const { id } = await createStage({ name: "Em conversa 2", kind: "atendimento", afterId: null, visibleProfileIds: null }, g);
    await expect(moveStage(id, -1, g)).rejects.toThrow(/primeira etapa de cada tipo/);
    const order = (await db.select().from(stages).where(eq(stages.active, true)).orderBy(asc(stages.position))).map((s) => s.name);
    expect(order.indexOf("Em conversa")).toBeLessThan(order.indexOf("Em conversa 2"));
  });
});
