import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { adCampaigns, channels, deals } from "../db/schema";
import { ingestEvolution, originOf, processHistoryEvents } from "./webhook";
import { resetDb } from "../../../test/db";
import { getDealDetail } from "../queries/deal";
import { AD_REPLY, adClickInbound, entryPointInbound } from "../../../test/fixtures/evolution";

const AD_ID = "120232984257440453";
beforeEach(async () => {
  await resetDb();
  await db.insert(channels).values({ name: "Principal", instanceName: "casa-principal", status: "conectado", phone: "+557133330000" });
});

describe("webhook: de onde veio a conversa", () => {
  it("primeira mensagem (formato real de produção) grava a porta de entrada", async () => {
    await ingestEvolution(entryPointInbound());
    expect((await db.select().from(deals))[0]).toMatchObject({ entryPoint: "busca", entryPointRaw: "global_search_new_chat|whatsapp", adId: null });
  });

  it("a ficha da conversa traz o anúncio (nome atual) e a porta", async () => {
    await ingestEvolution(adClickInbound());
    const [d] = await db.select().from(deals);
    expect((await getDealDetail(d.id))!.origem).toEqual({ ad: { id: AD_ID, name: "“Hoje quis mostrar um cabelo sem finalização. Porque…”", postUrl: "https://www.instagram.com/p/TESTE123/" }, entryPoint: "anuncio" });
    await ingestEvolution(entryPointInbound());
    const other = (await db.select().from(deals)).find((x) => x.id !== d.id)!;
    expect((await getDealDetail(other.id))!.origem).toEqual({ ad: null, entryPoint: "busca" });
  });

  it("botão do Instagram: porta 'instagram'", async () => {
    await ingestEvolution(entryPointInbound({ source: "click_to_chat_link", app: "instagram" }));
    expect((await db.select().from(deals))[0].entryPoint).toBe("instagram");
  });

  it("clique no anúncio (data.contextInfo): anúncio, origem 'Anúncio Instagram' e o anúncio na lista", async () => {
    await ingestEvolution(adClickInbound());
    expect((await db.select().from(deals))[0]).toMatchObject({ adId: AD_ID, entryPoint: "anuncio", sourceLabel: "Anúncio Instagram" });
    expect((await db.select().from(adCampaigns)).map((c) => c.adId)).toEqual([AD_ID]);
  });

  it("anúncio dentro do contextInfo do tipo da mensagem também conta", async () => {
    await ingestEvolution(adClickInbound({ inMessage: true }));
    expect((await db.select().from(deals))[0]).toMatchObject({ adId: AD_ID, sourceLabel: "Anúncio Instagram" });
  });

  it("mensagem da Casa (fromMe) com anúncio não grava nada", async () => {
    const p = adClickInbound();
    await ingestEvolution({ ...p, data: { ...p.data, key: { ...p.data.key, fromMe: true } } });
    expect(await db.select().from(adCampaigns)).toHaveLength(0);
    expect((await db.select().from(deals))[0]?.adId ?? null).toBeNull();
  });

  it("grupo não vira conversa nem anúncio", async () => {
    await ingestEvolution(adClickInbound({ jid: "120363000000000000@g.us" }));
    expect(await db.select().from(adCampaigns)).toHaveLength(0);
  });

  it("originOf junta o contextInfo de fora e o do tipo da mensagem (embrulho de mensagem temporária incluso)", () => {
    expect(originOf({ message: { ephemeralMessage: { message: { extendedTextMessage: { text: "oi", contextInfo: { externalAdReply: AD_REPLY } } } } } } as never).ad?.adId).toBe(AD_ID);
    expect(originOf({ contextInfo: null, message: { conversation: "oi" } }).ad).toBeNull();
  });

  it("histórico (messages.set): o anúncio e a porta da primeira mensagem da cliente entram na conversa criada", async () => {
    const now = Math.floor(Date.now() / 1000);
    const click = adClickInbound({ ts: now - 3600 }).data;
    const batch = { event: "messages.set", instance: "casa-principal", data: [
      { ...click, key: { ...click.key, id: "H1" } },
      { key: { remoteJid: click.key.remoteJid, fromMe: true, id: "H2" }, message: { conversation: "Oi! Tudo bem?" }, messageTimestamp: now - 3500 },
    ] };
    await ingestEvolution(batch as never);
    await processHistoryEvents();
    expect((await db.select().from(deals))[0]).toMatchObject({ adId: AD_ID, entryPoint: "anuncio", sourceLabel: "Anúncio Instagram" });
  });
});
