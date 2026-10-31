import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { adCampaigns, users } from "../db/schema";
import { recordInbound } from "../domain/deals";
import { nameAdCampaign } from "../domain/ad-origin";
import { parseOrigin } from "@/lib/ad-origin";
import { permsFor } from "../../../test/perms";
import { resetDb } from "../../../test/db";
import { AD_REPLY } from "../../../test/fixtures/evolution";
import { getQueue, getQueueFilterOptions } from "./queue";
import { getBoard } from "./board";
import { adFilterOptions } from "./ad-filter";

const adOf = (sourceId: string, body = AD_REPLY.body) => parseOrigin([{ externalAdReply: { ...AD_REPLY, sourceId, body } }]);
let n = 0;
const lead = async (origin: ReturnType<typeof parseOrigin> | null) => {
  n++;
  const r = await recordInbound({ channelId: null, externalId: `F${n}`, phoneRaw: `7199955${String(1000 + n)}`, body: "oi", hasAdReferral: !!origin?.ad, origin });
  if (!("dealId" in r)) throw new Error("sem conversa");
  return r.dealId;
};
let gestora: { id: string; name: string; email: string; perms: ReturnType<typeof permsFor> };
beforeEach(async () => {
  await resetDb(); n = 0;
  const [u] = await db.insert(users).values({ name: "Gestora", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
  gestora = { id: u.id, name: u.name, email: u.email, perms: permsFor("gestor") };
});
const queueIds = async (anuncio: string) => (await getQueue(gestora, { anuncio })).sections.flatMap((s) => s.items.map((i) => i.dealId)).sort();
const boardIds = async (anuncio: string) => (await getBoard({ anuncio }, gestora)).flatMap((s) => s.cards.map((c) => c.id)).sort();

describe("filtro 'Veio de anúncio' na Fila e no Quadro", () => {
  it("sim, nao, por anúncio e por campanha (anúncios com o mesmo nome)", async () => {
    const a = await lead(adOf("111")), b = await lead(adOf("222", "Outro")), c = await lead(null);
    expect(await queueIds("sim")).toEqual([a, b].sort());
    expect(await queueIds("nao")).toEqual([c]);
    expect(await queueIds("111")).toEqual([a]);
    expect(await boardIds("sim")).toEqual([a, b].sort());
    expect(await boardIds("222")).toEqual([b]);
    await nameAdCampaign("111", "Método Fiaes", gestora.id); await nameAdCampaign("222", "Método Fiaes", gestora.id);
    expect(await queueIds("111")).toEqual([a, b].sort());
    // Valor estranho: sem filtro.
    expect(await queueIds("1;x")).toEqual([a, b, c].sort());
  });

  it("opções do filtro: uma por campanha (nome) ou por anúncio sem nome; arquivado e sem conversa ficam fora", async () => {
    await lead(adOf("111")); await lead(adOf("222", "Outro")); await lead(adOf("333", "Terceiro"));
    await db.insert(adCampaigns).values({ adId: "444", body: "Sem conversa" });
    await nameAdCampaign("111", "Método Fiaes", gestora.id); await nameAdCampaign("222", "Método Fiaes", gestora.id);
    await db.update(adCampaigns).set({ archivedAt: new Date() }).where(eqAd("333"));
    expect(await adFilterOptions()).toEqual([{ id: "111", label: "Método Fiaes" }]);
    expect((await getQueueFilterOptions(gestora)).ads).toEqual([{ id: "111", label: "Método Fiaes" }]);
  });
});

const eqAd = (id: string) => eq(adCampaigns.adId, id);
