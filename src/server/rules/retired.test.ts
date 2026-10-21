import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { automations, channels, deals, outbox, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { scheduleAutomation } from "../../../test/schedule-automations";
import { recordInbound } from "../domain/deals";
import { saveAutomation, toggleAutomation } from "../domain/config";
import { saveLembreteD1 } from "../domain/client-link/reminder";
import { DEFAULT_REMINDER_TEXT, DEFAULT_RESCHEDULED_TEXT } from "../domain/client-link/settings";
import { fazerVirada } from "../../../test/virada";
import { AUTOMATION_TEMPLATES } from "./templates";
import { activeAutomationFilter, RETIRED_AUTOMATION_KEYS } from "./retired";
import { runRules } from "./engine";

/**
 * Plano 5 (spec "Juntar e tirar"): o lembrete da véspera é um só, o de Configurações › Mensagens (`lembrete_d1`). As automações
 * `lembrete_agendamento` e `confirmacao_d1` saem da tela, do índice, do motor e da trava; em produção estão desligadas (sem migration).
 */
const T0 = new Date("2026-10-13T13:00:00Z");
const LIGADO = { enabled: true, comLink: false, texto: DEFAULT_REMINDER_TEXT, textoRemarcado: DEFAULT_RESCHEDULED_TEXT };
/** Liga o lembrete com a Virada feita (Task 10) e a confirmação de envio real. */
const ligarLembrete = async (g: string) => { await fazerVirada("lembrete", g); return saveLembreteD1(LIGADO, g, { confirmouEnvio: true }); };
let g = "";
beforeEach(async () => {
  await resetDb();
  [{ id: g }] = await db.insert(users).values({ name: "Thaíse", email: "t@c.com", role: "gestor", passwordHash: "x" }).returning();
});

describe("automações aposentadas (lembrete_agendamento e confirmacao_d1)", () => {
  it("são as duas do lembrete da véspera", () => {
    expect([...RETIRED_AUTOMATION_KEYS].sort()).toEqual(["confirmacao_d1", "lembrete_agendamento"]);
  });

  it("a lista da tela e o índice deixam de fora as aposentadas e mantêm as personalizadas (sem chave)", async () => {
    await scheduleAutomation("texto", { key: "lembrete_agendamento" });
    await scheduleAutomation("enquete", { key: "confirmacao_d1", enabled: false });
    const minha = await scheduleAutomation("texto", { enabled: false });
    const visiveis = await db.select().from(automations).where(activeAutomationFilter());
    expect(visiveis.map((a) => a.key)).not.toContain("lembrete_agendamento");
    expect(visiveis.map((a) => a.key)).not.toContain("confirmacao_d1");
    expect(visiveis.map((a) => a.id)).toContain(minha.id);
  });

  it("o motor não roda uma aposentada que tenha ficado ligada", async () => {
    const [ch] = await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "conectado", phone: "+557199990404" }).returning();
    const r = await recordInbound({ channelId: ch.id, externalId: "x1", phoneRaw: "71999990901", body: "oi", at: T0, now: T0 });
    if (!("dealId" in r)) throw new Error("sem lead");
    await db.update(deals).set({ scheduledAt: new Date(T0.getTime() + 20 * 3_600_000) }).where(eq(deals.id, r.dealId));
    await db.execute(`update deals set stage_id = (select id from stages where key = 'agendado') where id = '${r.dealId}'` as never);
    await scheduleAutomation("texto", { key: "lembrete_agendamento" });
    await runRules(T0);
    expect(await db.select().from(outbox)).toHaveLength(0);
  });

  it("uma aposentada ligada não trava o lembrete da véspera (ninguém a vê para desligar)", async () => {
    await scheduleAutomation("texto", { key: "lembrete_agendamento" });
    await expect(ligarLembrete(g)).resolves.toBeUndefined();
  });

  it("a trava do lembrete da véspera continua com automação personalizada de agendamento, nos dois sentidos", async () => {
    const minha = await scheduleAutomation("texto");
    await expect(ligarLembrete(g)).rejects.toThrow("Desligue antes o lembrete ou a enquete de agendamento das Automações");
    await toggleAutomation(minha.id, false, g);
    await ligarLembrete(g);
    await expect(toggleAutomation(minha.id, true, g, { confirmouEnvio: true })).rejects.toThrow("Desligue o lembrete do horário (no fim desta tela)");
  });

  it("sem a trava enquete × lembrete entre automações: com o lembrete da véspera desligado, as duas ligam", async () => {
    const texto = await scheduleAutomation("texto", { enabled: false }), enquete = await scheduleAutomation("enquete", { enabled: false });
    await toggleAutomation(texto.id, true, g, { confirmouEnvio: true });
    await expect(toggleAutomation(enquete.id, true, g, { confirmouEnvio: true })).resolves.toBeUndefined();
    await expect(saveAutomation(null, { name: "As duas", enabled: true, trigger: { type: "agendamento_em_horas", hours: 24 }, conditions: [],
      actions: [{ type: "enviar_mensagem", message: "Oi {nome}" }, { type: "enviar_enquete_confirmacao", message: "Confirma, {nome}?" }] }, g, { confirmouEnvio: true })).resolves.toBeTruthy();
  });

  it("nenhum modelo recria o lembrete da véspera (faltar X horas com mensagem ou enquete)", () => {
    const recria = AUTOMATION_TEMPLATES.filter((t) => t.rule.trigger.type === "agendamento_em_horas" && t.rule.actions.some((a) => a.type === "enviar_mensagem" || a.type === "enviar_enquete_confirmacao"));
    expect(recria.map((t) => t.id)).toEqual([]);
  });
});
