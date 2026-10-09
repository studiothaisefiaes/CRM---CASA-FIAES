import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { automations, users } from "../db/schema";
import { saveAutomation, restoreAutomation, setMember, addListItem, previewAutomation } from "./config";
import { recordInbound } from "./deals";
import { resetDb } from "../../../test/db";

describe("configurações", () => {
  let gestor: string;
  beforeEach(async () => {
    await resetDb();
    [{ id: gestor }] = await db.insert(users).values({ name: "Thaíse", email: "t@c.com", role: "gestor", passwordHash: "x" }).returning();
  });

  it("automação: editar gera versão e dá para voltar", async () => {
    const [a] = await db.select().from(automations).where(eq(automations.key, "lead_2min"));
    await saveAutomation(a.id, { name: a.name, enabled: true, trigger: { type: "sem_resposta_minutos", minutes: 2 }, conditions: [{ type: "etapa_em", stages: ["lead"] }], actions: [{ type: "alertar_gestao", message: "v1 {nome}" }] }, gestor);
    await saveAutomation(a.id, { name: a.name, enabled: true, trigger: { type: "sem_resposta_minutos", minutes: 5 }, conditions: [], actions: [{ type: "alertar_gestao", message: "v2 {nome}" }] }, gestor);
    let [cur] = await db.select().from(automations).where(eq(automations.id, a.id));
    expect(cur.version).toBe(3);
    await restoreAutomation(a.id, 2, gestor);
    [cur] = await db.select().from(automations).where(eq(automations.id, a.id));
    expect((cur.trigger as { minutes: number }).minutes).toBe(2);
    expect(cur.version).toBe(4);
  });

  it("automação inválida é recusada", async () => {
    await expect(saveAutomation(null, { name: "x", enabled: true, trigger: { type: "sem_resposta_minutos", minutes: 0 }, conditions: [], actions: [] } as never, gestor)).rejects.toThrow();
  });

  it("prévia diz quantos leads seriam afetados", async () => {
    await recordInbound({ channelId: null, externalId: "p1", phoneRaw: "71999990000", body: "oi", at: new Date(Date.now() - 10 * 60_000) });
    const r = await previewAutomation({ name: "teste", enabled: true, trigger: { type: "sem_resposta_minutos", minutes: 5 }, conditions: [{ type: "etapa_em", stages: ["lead"] }], actions: [{ type: "alertar_gestao", message: "aviso" }] });
    expect(r.count).toBe(1);
  });

  it("não deixa o CRM ficar sem gestão", async () => {
    await expect(setMember(gestor, { active: false }, gestor)).rejects.toThrow(/próprio/);
    const [{ id: outro }] = await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "gestor", passwordHash: "x" }).returning();
    await setMember(outro, { role: "atendente" }, gestor);
    await expect(setMember(gestor, { role: "atendente" }, outro)).rejects.toThrow(/pelo menos uma/);
  });

  it("resposta pronta exige texto e normaliza o atalho", async () => {
    await expect(addListItem("quick_reply", "Promo", "", gestor)).rejects.toThrow(/texto/);
    await addListItem("quick_reply", "/Promo Outubro", "Oi {nome}!", gestor);
    const rows = await db.query.lists.findMany({ where: (l, { eq }) => eq(l.label, "promo-outubro") });
    expect(rows.length).toBe(1);
  });
});
