import { it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { alerts, channels, webhookEvents } from "../db/schema";
import { ingestEvolution, MAX_ATTEMPTS, processHistoryEvents } from "./webhook";
import { resetDb } from "../../../test/db";

// Lote de histórico que nunca entra (horário inválido derruba a gravação): antes ficava parado em silêncio depois da 8ª tentativa.
const badBatch = { event: "messages.set", instance: "rec", data: [{ key: { remoteJid: "5571911110001@s.whatsapp.net", fromMe: false, id: "H1" }, message: { conversation: "oi" }, messageTimestamp: "x" }] };

beforeEach(async () => {
  await resetDb();
  await db.insert(channels).values({ name: "Recepção", instanceName: "rec", status: "conectado", phone: "+557199990404" });
});

it("na última tentativa, a gestão recebe um aviso (uma vez só); antes disso, nada", async () => {
  await ingestEvolution(badBatch as never);
  await db.update(webhookEvents).set({ attempts: MAX_ATTEMPTS - 2 });
  await processHistoryEvents();
  expect(await db.select().from(alerts)).toHaveLength(0);
  await processHistoryEvents();
  const a = await db.select().from(alerts);
  expect(a.map((x) => [x.audience, x.type])).toEqual([["gestao", "historico_falhou"]]);
  expect(a[0].message).toContain("histórico");
  expect((await db.select().from(webhookEvents))[0].attempts).toBe(MAX_ATTEMPTS);
  await processHistoryEvents(); // não pega mais o lote
  expect(await db.select().from(alerts)).toHaveLength(1);
});

it("lote que falha e depois entra não avisa", async () => {
  await ingestEvolution({ ...badBatch, data: [{ ...badBatch.data[0], messageTimestamp: Math.floor(Date.now() / 1000) - 3600 }] } as never);
  await processHistoryEvents();
  expect(await db.select().from(alerts).where(eq(alerts.type, "historico_falhou"))).toHaveLength(0);
});
