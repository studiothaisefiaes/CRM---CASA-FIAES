import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { automations, lists, users } from "../db/schema";
import { saveAutomation, restoreAutomation, toggleAutomation, addListItem, setKeywordBoost } from "./config";
import { previewCandidates } from "../rules/preview";
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

  it("ligar (ou salvar ligada) regra que envia exige a confirmação de envio real no servidor; regra só de alerta liga sem ela", async () => {
    const envia = { name: "Preço", enabled: true, trigger: { type: "cliente_escreveu" as const, words: ["valor"] }, conditions: [], actions: [{ type: "enviar_mensagem" as const, message: "Oi, {nome}! Já te mando." }] };
    await expect(saveAutomation(null, envia, gestor)).rejects.toThrow("Confirme o envio real para ligar.");
    const id = await saveAutomation(null, { ...envia, enabled: false }, gestor); // desligada: sem confirmação
    await expect(toggleAutomation(id, true, gestor)).rejects.toThrow("Confirme o envio real para ligar.");
    expect((await db.select().from(automations).where(eq(automations.id, id)))[0].enabled).toBe(false);
    await toggleAutomation(id, true, gestor, { confirmouEnvio: true });
    expect((await db.select().from(automations).where(eq(automations.id, id)))[0].enabled).toBe(true);
    await expect(saveAutomation(id, { ...envia, actions: [{ type: "enviar_mensagem", message: "Texto novo, {nome}" }] }, gestor)).rejects.toThrow("Confirme o envio real para ligar.");
    await saveAutomation(id, { ...envia, actions: [{ type: "enviar_mensagem", message: "Texto novo, {nome}" }] }, gestor, { confirmouEnvio: true });
    const alerta = await saveAutomation(null, { ...envia, actions: [{ type: "alertar_gestao", message: "{nome} perguntou" }] }, gestor);
    await toggleAutomation(alerta, false, gestor);
    await expect(toggleAutomation(alerta, true, gestor)).resolves.toBeUndefined();
  });

  it("automação inválida é recusada", async () => {
    await expect(saveAutomation(null, { name: "x", enabled: true, trigger: { type: "sem_resposta_minutos", minutes: 0 }, conditions: [], actions: [] } as never, gestor)).rejects.toThrow();
  });

  it("prévia diz quantos leads seriam afetados", async () => {
    const now = new Date("2026-10-13T13:00:00Z"); // terça, 10h
    await recordInbound({ channelId: null, externalId: "p1", phoneRaw: "71999990000", body: "oi", at: new Date(now.getTime() - 10 * 60_000) });
    const r = await previewCandidates({ name: "teste", enabled: true, trigger: { type: "sem_resposta_minutos", minutes: 5 }, conditions: [{ type: "etapa_em", stages: ["lead"] }], actions: [{ type: "alertar_gestao", message: "aviso" }] }, now);
    expect(r.count).toBe(1);
  });

  it("palavra-chave: exige ao menos uma frase, guarda uma por linha e liga/desliga 'subir na Fila'", async () => {
    await expect(addListItem("keyword", "Mega hair", "  ", gestor)).rejects.toThrow("Escreva ao menos uma palavra ou frase.");
    await addListItem("keyword", "Mega hair", "mega hair\n\n aplique ", gestor);
    const [k] = await db.select().from(lists).where(eq(lists.label, "Mega hair"));
    expect(k.body).toBe("mega hair\naplique");
    await setKeywordBoost(k.id, true, gestor);
    expect((await db.select().from(lists).where(eq(lists.id, k.id)))[0].meta).toEqual({ boost: true });
  });

  it("resposta pronta exige texto e normaliza o atalho", async () => {
    await expect(addListItem("quick_reply", "Promo", "", gestor)).rejects.toThrow(/texto/);
    await addListItem("quick_reply", "/Promo Outubro", "Oi {nome}!", gestor);
    const rows = await db.query.lists.findMany({ where: (l, { eq }) => eq(l.label, "promo-outubro") });
    expect(rows.length).toBe(1);
  });
});
