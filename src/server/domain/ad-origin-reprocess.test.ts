import { beforeEach, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { adCampaigns, channels, deals, webhookEvents } from "../db/schema";
import { ingestEvolution } from "../whatsapp/webhook";
import { reprocessAdOrigins } from "./ad-origin-reprocess";
import { resetDb } from "../../../test/db";
import { adClickInbound, entryPointInbound, inboundText } from "../../../test/fixtures/evolution";

const AD_ID = "120232984257440453";
beforeEach(async () => {
  await resetDb();
  await db.insert(channels).values({ name: "Principal", instanceName: "casa-principal", status: "conectado" });
});

/** Como era antes de 26/10: o evento cru ficou guardado, mas a conversa só ganhou "Anúncio" (sem anúncio nem porta). */
async function antigo() {
  await ingestEvolution(adClickInbound());
  await ingestEvolution(entryPointInbound({ source: "click_to_chat_link", app: "instagram" }));
  await ingestEvolution(inboundText("SEMORIGEM1", "5571900000009@s.whatsapp.net"));
  await db.update(deals).set({ adId: null, adCtwaClid: null, adAt: null, entryPoint: null, entryPointRaw: null, sourceLabel: sql`case when ${deals.sourceLabel} like 'Anúncio%' then 'Anúncio' else ${deals.sourceLabel} end` });
  await db.delete(adCampaigns);
}
it("--dry-run conta o que faria e não grava nada", async () => {
  await antigo();
  const r = await reprocessAdOrigins({ dryRun: true });
  expect(r).toMatchObject({ mensagens: 2, semConversa: 0, anuncios: 1, portas: 2, origens: 1, anunciosVistos: 1 });
  expect(await db.select().from(adCampaigns)).toHaveLength(0);
  expect((await db.select().from(deals)).every((d) => d.adId === null && d.entryPoint === null)).toBe(true);
});

it("aplica só onde está vazio e é idempotente", async () => {
  await antigo();
  const r = await reprocessAdOrigins({ dryRun: false });
  expect(r).toMatchObject({ anuncios: 1, portas: 2, origens: 1 });
  const all = await db.select().from(deals);
  expect(all.find((d) => d.adId === AD_ID)).toMatchObject({ entryPoint: "anuncio", sourceLabel: "Anúncio Instagram" });
  expect(all.filter((d) => d.entryPoint === "instagram")).toHaveLength(1);
  expect(await db.select().from(adCampaigns)).toHaveLength(1);
  expect(await reprocessAdOrigins({ dryRun: false })).toMatchObject({ anuncios: 0, portas: 0, origens: 0 });
});

it("lê também os lotes do histórico (messages.set) e ignora a mensagem da Casa", async () => {
  const click = adClickInbound({ id: "H1", ts: Math.floor(Date.now() / 1000) - 600 }).data;
  await ingestEvolution({ event: "messages.set", instance: "casa-principal", data: [click, { ...click, key: { ...click.key, id: "H2", fromMe: true } }] } as never);
  const { processHistoryEvents } = await import("../whatsapp/webhook");
  await processHistoryEvents();
  await db.update(deals).set({ adId: null, adCtwaClid: null, entryPoint: null, sourceLabel: null });
  const r = await reprocessAdOrigins({ dryRun: false });
  expect(r).toMatchObject({ mensagens: 1, anuncios: 1, portas: 1 });
  expect((await db.select().from(deals))[0]).toMatchObject({ adId: AD_ID, sourceLabel: "Anúncio Instagram" });
});

it("evento de mensagem que não está no CRM conta como sem conversa", async () => {
  await db.insert(webhookEvents).values({ provider: "evolution", externalId: "x1", event: "MESSAGES_UPSERT", payload: adClickInbound({ id: "NAOEXISTE" }) as never, processedAt: new Date() });
  expect(await reprocessAdOrigins({ dryRun: false })).toMatchObject({ mensagens: 1, semConversa: 1, anuncios: 0 });
  expect((await db.select().from(webhookEvents).where(eq(webhookEvents.externalId, "x1")))[0].processedAt).not.toBeNull();
});
