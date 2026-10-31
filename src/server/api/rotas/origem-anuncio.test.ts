import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { deals } from "@/server/db/schema";
import { recordInbound } from "@/server/domain/deals";
import { nameAdCampaign } from "@/server/domain/ad-origin";
import { parseOrigin } from "@/lib/ad-origin";
import { resetDb } from "../../../../test/db";
import { chamar, chaveDe, pessoa } from "../../../../test/api-fixtures";
import { AD_REPLY } from "../../../../test/fixtures/evolution";
import { __zerarLimites } from "../limite";
import { montarOpenApi } from "../openapi";
import { ROTAS, relatorio } from "./index";
import { listarConversas, verConversa } from "./conversas";

const AD_ID = "120232984257440453";
beforeEach(async () => { await resetDb(); __zerarLimites(); });
let n = 0;
const lead = async (origin: ReturnType<typeof parseOrigin> | null) => {
  n++;
  const r = await recordInbound({ channelId: null, externalId: `API-${n}-${Math.random()}`, phoneRaw: `7199991${String(1000 + n)}`, body: "oi", hasAdReferral: !!origin?.ad, origin });
  if (!("dealId" in r)) throw new Error("sem lead");
  await db.update(deals).set({ ownerId: null }).where(eq(deals.id, r.dealId));
  return r.dealId;
};
const AD = parseOrigin([{ externalAdReply: AD_REPLY, entryPointConversionSource: "ctwa_ad", entryPointConversionApp: "instagram" }]);
const LINK = parseOrigin([{ entryPointConversionSource: "click_to_chat_link", entryPointConversionApp: "whatsapp" }]);

describe("API: de onde veio a conversa", () => {
  it("conversa traz o anúncio (com o nome atual da campanha) e a porta de entrada; filtro ?anuncio=", async () => {
    const g = await pessoa("gestao");
    const k = await chaveDe(g.id, ["ler"]);
    const a = await lead(AD);
    const b = await lead(LINK);
    await nameAdCampaign(AD_ID, "Método Fiaes outubro", g.id);
    const one = await chamar(verConversa, { chave: k, params: { id: a } });
    expect(one.json.dados).toMatchObject({
      origem: "Método Fiaes outubro", porta_de_entrada: "anuncio",
      anuncio: { id: AD_ID, nome: "Método Fiaes outubro", plataforma: "instagram", post_url: "https://www.instagram.com/p/TESTE123/" },
    });
    expect((await chamar(verConversa, { chave: k, params: { id: b } })).json.dados).toMatchObject({ anuncio: null, porta_de_entrada: "link" });
    const ids = async (q: Record<string, string>) => ((await chamar(listarConversas, { chave: k, query: q })).json.dados as { id: string }[]).map((x) => x.id);
    expect(await ids({ anuncio: "sim" })).toEqual([a]);
    expect(await ids({ anuncio: "nao" })).toEqual([b]);
    expect(await ids({ anuncio: AD_ID })).toEqual([a]);
    expect((await chamar(listarConversas, { chave: k, query: { anuncio: "1;x" } })).status).toBe(400);
  });

  it("relatório de origem: ?recorte=anuncio e ?recorte=porta; sem recorte, o de sempre; R$ só com ver valores", async () => {
    await lead(AD); await lead(LINK);
    const kg = await chaveDe((await pessoa("gestao")).id, ["ler"]);
    const base = await chamar(relatorio("origem"), { chave: kg });
    expect(Array.isArray(base.json.dados) && (base.json.dados as { origem: string }[]).some((r) => r.origem === "Anúncio Instagram")).toBe(true);
    const ads = await chamar(relatorio("origem"), { chave: kg, query: { recorte: "anuncio" } });
    expect(ads.json.dados).toEqual([expect.objectContaining({ anuncios: [AD_ID], leads: 1, receitaCents: 0 })]);
    const portas = await chamar(relatorio("origem"), { chave: kg, query: { recorte: "porta" } });
    expect((portas.json.dados as { porta: string | null; leads: number }[]).map((r) => [r.porta, r.leads])).toEqual([["anuncio", 1], ["link", 1]]);
    const ka = await chaveDe((await pessoa(["relatorios.ver", "relatorios.equipe"], "Ana")).id, ["ler"]);
    expect(((await chamar(relatorio("origem"), { chave: ka, query: { recorte: "anuncio" } })).json.dados as { receitaCents: unknown }[])[0].receitaCents).toBeNull();
  });

  it("OpenAPI: os campos e parâmetros novos estão documentados", () => {
    const doc = JSON.stringify(montarOpenApi(ROTAS));
    for (const s of ["porta_de_entrada", "\"anuncio\"", "post_url", "recorte"]) expect(doc).toContain(s);
  });
});
