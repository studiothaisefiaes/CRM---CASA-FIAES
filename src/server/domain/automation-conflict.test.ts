import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { automations, users } from "../db/schema";
import { saveAutomation, toggleAutomation } from "./config";
import { resetDb } from "../../../test/db";

describe("confirmação por enquete x lembrete de agendamento", () => {
  let gestor = "";
  beforeEach(async () => { await resetDb(); [{ id: gestor }] = await db.insert(users).values({ name: "Thaíse", email: "t@c.com", role: "gestor", passwordHash: "x" }).returning(); });
  const get = async (key: string) => (await db.select().from(automations).where(eq(automations.key, key)))[0];

  it("não deixa ligar a enquete com o lembrete ligado, nem o inverso (ligar pelo interruptor)", async () => {
    const enq = await get("confirmacao_d1"), lem = await get("lembrete_agendamento");
    await toggleAutomation(lem.id, true, gestor);
    await expect(toggleAutomation(enq.id, true, gestor)).rejects.toThrow("Desligue o lembrete de agendamento antes de ligar a confirmação por enquete");
    expect((await get("confirmacao_d1")).enabled).toBe(false);
    await toggleAutomation(lem.id, false, gestor);
    await toggleAutomation(enq.id, true, gestor);
    await expect(toggleAutomation(lem.id, true, gestor)).rejects.toThrow("Desligue a confirmação por enquete antes de ligar o lembrete de agendamento");
    expect((await get("lembrete_agendamento")).enabled).toBe(false);
  });
  it("ao salvar o formulário também vale", async () => {
    const enq = await get("confirmacao_d1"), lem = await get("lembrete_agendamento");
    await toggleAutomation(lem.id, true, gestor);
    const input = { name: enq.name, enabled: true, trigger: enq.trigger, conditions: enq.conditions, actions: enq.actions } as never;
    await expect(saveAutomation(enq.id, input, gestor)).rejects.toThrow(/Desligue o lembrete de agendamento/);
    await expect(saveAutomation(enq.id, { ...(input as object), enabled: false } as never, gestor)).resolves.not.toThrow();
  });
  it("uma só automação com lembrete em texto e enquete juntos também é recusada", async () => {
    const enq = await get("confirmacao_d1");
    const both = { name: "As duas", enabled: true, trigger: enq.trigger, conditions: [], actions: [
      { type: "enviar_mensagem", message: "Oi {nome}, lembrete" }, { type: "enviar_enquete_confirmacao", message: "Confirma, {nome}?" }] } as never;
    await expect(saveAutomation(null, both, gestor)).rejects.toThrow(/lembrete em texto e a enquete/);
    await expect(saveAutomation(null, { ...(both as object), enabled: false } as never, gestor)).rejects.toThrow(/lembrete em texto e a enquete/);
  });
});
