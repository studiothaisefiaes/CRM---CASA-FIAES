import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { adCampaigns, auditLog, contacts, dealEvents, deals, stages, users } from "../db/schema";
import { recordInbound } from "./deals";
import { createSource } from "./sources";
import { captureOrigin, listAdCampaigns, nameAdCampaign, setAdCampaignArchived } from "./ad-origin";
import { parseOrigin } from "@/lib/ad-origin";
import { resetDb } from "../../../test/db";
import { AD_REPLY } from "../../../test/fixtures/evolution";

const AD = parseOrigin([{ externalAdReply: AD_REPLY, entryPointConversionSource: "ctwa_ad", entryPointConversionApp: "instagram" }]);
const BUSCA = parseOrigin([{ entryPointConversionSource: "global_search_new_chat", entryPointConversionApp: "whatsapp" }]);
const AD_ID = "120232984257440453";
let uid = "";
beforeEach(async () => {
  await resetDb();
  [{ id: uid }] = await db.insert(users).values({ name: "Gestão", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
});
const deal = async (id: string) => (await db.select().from(deals).where(eq(deals.id, id)))[0];
const inbound = async (externalId: string, phone: string, origin: ReturnType<typeof parseOrigin>, body = "Oi") => {
  const r = await recordInbound({ channelId: null, externalId, phoneRaw: phone, body, hasAdReferral: !!origin.ad, origin });
  if (!("dealId" in r)) throw new Error("sem conversa");
  return r.dealId;
};

describe("captura da origem na conversa", () => {
  it("conversa nova de anúncio: anúncio, clique, porta 'anuncio' e origem 'Anúncio Instagram'; o anúncio entra na lista", async () => {
    const id = await inbound("A1", "71999990001", AD);
    expect(await deal(id)).toMatchObject({ adId: AD_ID, adCtwaClid: "AffTESTE123", entryPoint: "anuncio", entryPointRaw: "ctwa_ad|instagram", sourceLabel: "Anúncio Instagram", origin: "Anúncio Instagram" });
    expect((await deal(id)).adAt).toBeInstanceOf(Date);
    const [c] = await db.select().from(adCampaigns);
    expect(c).toMatchObject({ adId: AD_ID, sourceApp: "instagram", postUrl: "https://www.instagram.com/p/TESTE123/", title: "CASA FIAES", name: null });
  });

  it("anúncio já nomeado pela gestão: a conversa nova nasce com o nome da campanha", async () => {
    await db.insert(adCampaigns).values({ adId: AD_ID, name: "Método Fiaes outubro" });
    const id = await inbound("A1", "71999990001", AD);
    expect((await deal(id)).sourceLabel).toBe("Método Fiaes outubro");
  });

  it("conversa nova sem anúncio: só a porta de entrada; a origem segue a regra de sempre", async () => {
    const id = await inbound("B1", "71999990002", BUSCA, "vim pelo insta");
    expect(await deal(id)).toMatchObject({ adId: null, entryPoint: "busca", entryPointRaw: "global_search_new_chat|whatsapp", sourceLabel: "Instagram" });
  });

  it("link/QR de origem vence o anúncio na origem (o anúncio fica registrado)", async () => {
    const s = await createSource({ label: "Bio do Instagram", kind: "instagram" }, uid);
    const id = await inbound("A1", "71999990001", AD, `Oi #${s.code}`);
    expect(await deal(id)).toMatchObject({ adId: AD_ID, sourceLabel: "Bio do Instagram", sourceId: s.id });
  });

  it("clicou no anúncio com conversa já aberta: registra o anúncio sem mudar etapa, origem nem porta", async () => {
    const id = await inbound("B1", "71999990002", BUSCA);
    const before = await deal(id);
    expect(await inbound("A2", "71999990002", AD)).toBe(id);
    const after = await deal(id);
    expect(after).toMatchObject({ adId: AD_ID, adCtwaClid: "AffTESTE123", entryPoint: "busca", sourceLabel: before.sourceLabel, stageId: before.stageId });
    const evs = await db.select().from(dealEvents).where(eq(dealEvents.dealId, id));
    expect(evs.find((e) => e.type === "anuncio")?.payload).toMatchObject({ adId: AD_ID });
  });

  it("a porta só vale na primeira mensagem; o anúncio que já existe na conversa nunca é trocado", async () => {
    const id = await inbound("A1", "71999990001", AD);
    await inbound("A2", "71999990001", parseOrigin([{ externalAdReply: { ...AD_REPLY, sourceId: "999", ctwaClid: "OUTRO" }, entryPointConversionSource: "click_to_chat_link" }]));
    expect(await deal(id)).toMatchObject({ adId: AD_ID, adCtwaClid: "AffTESTE123", entryPoint: "anuncio" });
  });

  it("captureOrigin é idempotente (reprocessar não muda nada) e diz o que mudou", async () => {
    const [lead] = await db.select().from(stages).where(eq(stages.kind, "lead"));
    const [{ id: contactId }] = await db.insert(contacts).values({ phoneE164: "+5571999990003" }).returning();
    const [d] = await db.insert(deals).values({ contactId, stageId: lead.id, origin: "Anúncio", sourceLabel: "Anúncio" }).returning();
    const at = new Date("2026-10-20T12:00:00Z");
    expect(await captureOrigin({ dealId: d.id, origin: AD, first: true, at })).toEqual({ ad: true, entry: true, label: true });
    expect(await captureOrigin({ dealId: d.id, origin: AD, first: true, at })).toEqual({ ad: false, entry: false, label: false });
    expect(await deal(d.id)).toMatchObject({ adId: AD_ID, sourceLabel: "Anúncio Instagram", origin: "Anúncio Instagram", adAt: at });
  });
});

describe("Anúncios em Configurações › Origens", () => {
  it("lista com quantas conversas, primeira e última vez; o nome vale para as conversas antigas (só as de origem automática)", async () => {
    const a = await inbound("A1", "71999990001", AD);
    const b = await inbound("A3", "71999990004", AD);
    await db.update(deals).set({ sourceLabel: "Indicação" }).where(eq(deals.id, b)); // a recepção corrigiu "Como conheceu"
    let [row] = await listAdCampaigns();
    expect(row).toMatchObject({ adId: AD_ID, label: "“Hoje quis mostrar um cabelo sem finalização. Porque…”", conversas: 2, archived: false });
    await nameAdCampaign(AD_ID, "  Método Fiaes outubro ", uid);
    expect((await deal(a)).sourceLabel).toBe("Método Fiaes outubro");
    expect((await deal(a)).origin).toBe("Método Fiaes outubro");
    expect((await deal(b)).sourceLabel).toBe("Indicação");
    [row] = await listAdCampaigns();
    expect(row).toMatchObject({ name: "Método Fiaes outubro", label: "Método Fiaes outubro" });
    // Tirar o nome: volta a origem automática.
    await nameAdCampaign(AD_ID, "", uid);
    expect((await deal(a)).sourceLabel).toBe("Anúncio Instagram");
    expect((await db.select().from(auditLog)).filter((x) => x.entity === "ad_campaign").length).toBe(2);
  });

  it("arquivar tira da lista principal (vai para o fim) e desarquivar volta", async () => {
    await inbound("A1", "71999990001", AD);
    await setAdCampaignArchived(AD_ID, true, uid);
    expect((await listAdCampaigns())[0].archived).toBe(true);
    await setAdCampaignArchived(AD_ID, false, uid);
    expect((await listAdCampaigns())[0].archived).toBe(false);
  });

  it("nome longo demais ou anúncio que não existe: erro com texto para a tela", async () => {
    await expect(nameAdCampaign(AD_ID, "x", uid)).rejects.toThrow(/não existe/);
    await inbound("A1", "71999990001", AD);
    await expect(nameAdCampaign(AD_ID, "x".repeat(81), uid)).rejects.toThrow(/longo/);
  });
});
