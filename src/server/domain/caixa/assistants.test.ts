import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { auditLog, comandaItemAssistants, professionals } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { bahia, cliente, NOW, setSetting } from "../../../../test/agenda-fixtures";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { comandaFechada } from "../../../../test/comanda-fixtures";
import { createVisit } from "../agenda/visits";
import { getComandaDetail } from "../../queries/caixa";
import { addItem, openComandaForAppointment, openWalkInComanda, reopenForCorrection, updateItem } from "./comandas";
import { setItemAssistants } from "./assistants";

let s: Awaited<ReturnType<typeof setupCaixa>>;
let sidney: { id: string }; let roberta: { id: string };
beforeEach(async () => {
  await resetDb(); s = await setupCaixa({ estoque: false });
  [sidney, roberta] = await db.insert(professionals).values([
    { name: "Sidney", fullName: "Sidney Souza", assistantOf: s.ana.id, agendaPosition: 3 },
    { name: "Roberta", fullName: "Roberta Lima", assistantOf: s.ana.id, agendaPosition: 4 },
  ]).returning();
});

const abrir = async (professionalId = s.ana.id) => {
  const c = await openWalkInComanda({ clientName: "Paula", requestKey: randomUUID(), item: { kind: "servico", serviceId: s.corte.id, professionalId } }, s.caixaRecepcao, NOW);
  const d = (await getComandaDetail(c.comandaId, s.cati.id))!;
  return { c, itemId: d.items[0].id };
};
const nomes = async (comandaId: string) => (await getComandaDetail(comandaId, s.cati.id))!.items[0].assistants.map((a) => [a.name, a.position]);
const recursos = (v: Record<string, unknown>) => setSetting("caixa_recursos", v);
const audits = () => db.select().from(auditLog).where(eq(auditLog.action, "assistente_alterado"));

describe("assistente na comanda", () => {
  it("o serviço da Ana nasce com as assistentes dela; trocar para Bia troca as assistentes (com rastro)", async () => {
    const { c, itemId } = await abrir();
    expect(await nomes(c.comandaId)).toEqual([["Roberta", 1], ["Sidney", 2]]);
    expect(await audits()).toHaveLength(0); // a sugestão automática de item novo não é rastro
    await updateItem(itemId, { professionalId: s.bia.id }, s.caixaRecepcao, NOW);
    expect(await nomes(c.comandaId)).toEqual([]);
    expect((await audits()).map((a) => a.data)).toMatchObject([{ item: "Corte", de: ["Roberta", "Sidney"], para: [] }]);
  });

  it("até 2, sem repetir, nunca a própria profissional, só na comanda aberta; auditado com de/para; igual não audita", async () => {
    await recursos({ assistentesMax: 2 });
    const { itemId } = await abrir();
    await expect(setItemAssistants(itemId, { professionalIds: [sidney.id, roberta.id, s.bia.id] }, s.caixaRecepcao)).rejects.toThrow("No máximo 2 assistentes por serviço.");
    await expect(setItemAssistants(itemId, { professionalIds: [s.ana.id] }, s.caixaRecepcao)).rejects.toThrow("A assistente não pode ser a própria profissional do serviço.");
    await expect(setItemAssistants(itemId, { professionalIds: [sidney.id, sidney.id] }, s.caixaRecepcao)).rejects.toThrow("A mesma assistente não pode entrar duas vezes.");
    await setItemAssistants(itemId, { professionalIds: [sidney.id] }, s.caixaRecepcao);
    await setItemAssistants(itemId, { professionalIds: [sidney.id] }, s.caixaRecepcao);
    const rows = await audits();
    expect(rows).toHaveLength(1);
    expect(rows[0].data).toMatchObject({ item: "Corte", de: ["Roberta", "Sidney"], para: ["Sidney"] });
    const f = await comandaFechada(s, { items: [{ serviceId: s.corte.id, professionalId: s.ana.id }], pays: [{ method: "pix", valueCents: 12000 }] });
    const [fi] = (await getComandaDetail(f.comandaId, s.cati.id))!.items;
    await expect(setItemAssistants(fi.id, { professionalIds: [] }, s.caixaRecepcao)).rejects.toThrow("Essa comanda já foi fechada.");
  });

  it("produto não tem assistente", async () => {
    const c = await openWalkInComanda({ clientName: "Paula", requestKey: randomUUID(), item: { kind: "produto", label: "Kit", unitCents: 5000 } }, s.caixaRecepcao, NOW);
    const [p] = (await getComandaDetail(c.comandaId, s.cati.id))!.items;
    await expect(setItemAssistants(p.id, { professionalIds: [sidney.id] }, s.caixaRecepcao)).rejects.toThrow("Só serviço tem assistente.");
  });

  it("a comanda que nasce do horário e a reaberta para corrigir levam as assistentes", async () => {
    const p = await cliente("Paula Souza");
    const v = await createVisit({ requestKey: randomUUID(), client: { contactId: p.contactId }, startsAt: bahia(15, 10).toISOString(), items: [{ serviceId: s.corte.id, professionalId: s.ana.id, preference: "escolhida" }] }, s.recepcao, bahia(15, 8));
    const r = await openComandaForAppointment(v.appointmentIds[0], s.caixaRecepcao, NOW);
    expect(await nomes(r.comandaId)).toEqual([["Roberta", 1], ["Sidney", 2]]);
    const f = await comandaFechada(s, { items: [{ serviceId: s.corte.id, professionalId: s.ana.id }], pays: [{ method: "pix", valueCents: 12000 }] });
    const re = await reopenForCorrection(f.comandaId, { reason: "corrigir" }, s.caixaGestao, NOW);
    expect(await nomes(re.comandaId)).toEqual([["Roberta", 1], ["Sidney", 2]]);
    expect(await db.select().from(comandaItemAssistants).where(eq(comandaItemAssistants.professionalId, sidney.id))).toHaveLength(3);
  });

  it("liga/desliga: desligado, o item novo nasce sem assistentes e setItemAssistants recusa", async () => {
    const { itemId } = await abrir();
    await recursos({ assistentes: false });
    const novo = await abrir();
    expect(await nomes(novo.c.comandaId)).toEqual([]);
    await expect(setItemAssistants(itemId, { professionalIds: [sidney.id] }, s.caixaRecepcao)).rejects.toThrow("Assistente na comanda está desligado em Configurações › Caixa.");
    expect((await getComandaDetail(novo.c.comandaId, s.cati.id))!.assistentes).toEqual({ on: false, max: 20 });
  });

  it("limite: com assistentesMax 1 só a Roberta é sugerida e 2 assistentes são recusadas", async () => {
    await recursos({ assistentesMax: 1 });
    const { c, itemId } = await abrir();
    expect(await nomes(c.comandaId)).toEqual([["Roberta", 1]]);
    await expect(setItemAssistants(itemId, { professionalIds: [sidney.id, roberta.id] }, s.caixaRecepcao)).rejects.toThrow("No máximo 1 assistente por serviço.");
    await addItem(c.comandaId, { kind: "servico", serviceId: s.corte.id, professionalId: s.ana.id }, s.caixaRecepcao, NOW);
    const [, segundo] = (await getComandaDetail(c.comandaId, s.cati.id))!.items;
    expect(segundo.assistants.map((a) => a.name)).toEqual(["Roberta"]);
  });

  it("sem limite prático (22/10): 5 assistentes num serviço, na ordem; o horário com 4 auxiliares passa as 4, sem aviso", async () => {
    const extra = await db.insert(professionals).values(["Carla", "Duda", "Eva"].map((name, k) => ({ name, fullName: `${name} Silva`, agendaPosition: 10 + k }))).returning();
    const { c, itemId } = await abrir();
    const ids = [sidney.id, roberta.id, s.bia.id, ...extra.slice(0, 2).map((x) => x.id)];
    await setItemAssistants(itemId, { professionalIds: ids }, s.caixaRecepcao);
    expect(await nomes(c.comandaId)).toEqual([["Sidney", 1], ["Roberta", 2], ["Bia", 3], ["Carla", 4], ["Duda", 5]]);
    const p = await cliente("Paula Souza");
    const v = await createVisit({ requestKey: randomUUID(), client: { contactId: p.contactId }, startsAt: bahia(15, 10).toISOString(),
      items: [{ serviceId: s.corte.id, professionalId: s.ana.id, preference: "escolhida", assistantIds: [sidney.id, roberta.id, extra[0].id, extra[2].id] }] }, s.recepcao, bahia(15, 8));
    const r = await openComandaForAppointment(v.appointmentIds[0], s.caixaRecepcao, NOW);
    expect(r.warnings ?? []).toEqual([]);
    expect(await nomes(r.comandaId)).toEqual([["Sidney", 1], ["Roberta", 2], ["Carla", 3], ["Eva", 4]]);
  });
});
