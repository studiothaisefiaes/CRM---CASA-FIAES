import { beforeEach, expect, it } from "vitest";
import { db } from "../db";
import { automations, channels, lists, settings, tags, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { loadConfigSnapshot } from "./config-index";

beforeEach(async () => { await resetDb(); });

it("lê o estado de cada configuração sem mudar nada", async () => {
  await db.insert(settings).values([
    { key: "auto_resposta", value: { enabled: true, text: "Oi, {nome}! A Casa abre às 9h." } },
    { key: "lembrete_d1", value: { enabled: false } },
  ]);
  await db.delete(automations); // o seed traz as regras padrão; aqui só as do teste
  await db.insert(automations).values([
    { name: "Avisa parado", enabled: true, trigger: { type: "parado_dias", days: 3 }, conditions: [], actions: [{ type: "alertar_responsavel", message: "x" }] },
    { name: "Parabéns", enabled: true, trigger: { type: "aniversario_em_dias", days: 0 }, conditions: [], actions: [{ type: "enviar_mensagem", text: "Parabéns" }] },
    { name: "Desligada", enabled: false, trigger: { type: "parado_dias", days: 5 }, conditions: [], actions: [{ type: "enviar_mensagem", text: "x" }] },
  ]);
  await db.insert(users).values([{ name: "Mirela", email: "m@ex.test", role: "atendente", passwordHash: "x" }, { name: "Tânia", email: "t@ex.test", role: "atendente", passwordHash: null }]);
  await db.insert(tags).values([{ name: "VIP" }, { name: "Método Fiaes" }]);
  await db.insert(channels).values({ name: "Recepção", instanceName: "e2e-cfgidx", status: "conectado", phone: "5571999990000" });
  const before = await db.select().from(settings);
  const s = await loadConfigSnapshot();
  expect(s.autoReply).toBe(true);
  expect(s.reminder).toBe(false);
  expect(s.welcome).toBe(false);
  expect(s.automations).toEqual({ on: 2, total: 3, sendingOn: 1 });
  expect(s.people).toEqual({ active: 2, pending: 1 });
  expect(s.tags).toBe(2);
  expect(s.whatsapp).toEqual({ connected: 1, total: 1 });
  expect(s.agendaMode).toBe("consulta");
  expect(s.hours?.saved).toBe(false);
  const quick = (await db.select().from(lists)).filter((l) => l.kind === "quick_reply" && l.active).length;
  expect(s.lists?.quick_reply ?? 0).toBe(quick);
  expect(await db.select().from(settings)).toEqual(before);
});
