import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { adCampaigns } from "../db/schema";
import { fetchAdNames, fetchAdSpend, MetaAdsError, metaAdsConfig, syncAdNamesFromMeta } from "./meta-ads";
import { resetDb } from "../../../test/db";

const ENV = { META_ADS_TOKEN: "token-de-teste", META_AD_ACCOUNT_ID: "act_123456" };
const cfg = metaAdsConfig(ENV)!;
type Call = { url: URL; init?: RequestInit };
/** fetch falso: devolve as respostas em ordem e guarda as chamadas. Nunca fala com o Meta de verdade. */
function fakeFetch(...bodies: { status?: number; json: unknown }[]) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: string | URL, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), init });
    const b = bodies.shift() ?? { json: {} };
    return new Response(JSON.stringify(b.json), { status: b.status ?? 200, headers: { "content-type": "application/json" } });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

describe("API de Marketing do Meta (preparada, desligada sem as variáveis)", () => {
  it("sem META_ADS_TOKEN e META_AD_ACCOUNT_ID: não faz nada (nem chama o fetch)", async () => {
    expect(metaAdsConfig({})).toBeNull();
    expect(metaAdsConfig({ META_ADS_TOKEN: "x" })).toBeNull();
    const f = fakeFetch();
    expect(await fetchAdNames("120232984257440453", { config: null, fetch: f.fn })).toBeNull();
    expect(await fetchAdSpend(["1"], { since: "2026-10-01", until: "2026-10-26" }, { config: null, fetch: f.fn })).toEqual(new Map());
    expect(f.calls).toHaveLength(0);
  });

  it("conta sem o act_ ganha o prefixo; versão padrão e trocável", () => {
    expect(metaAdsConfig({ ...ENV, META_AD_ACCOUNT_ID: "123456" })).toMatchObject({ accountId: "act_123456", version: "v23.0" });
    expect(metaAdsConfig({ ...ENV, META_GRAPH_VERSION: "v24.0" })?.version).toBe("v24.0");
  });

  it("nome do anúncio, da campanha e do conjunto: /{ad_id}?fields=name,campaign{name},adset{name}, chave no cabeçalho (nunca na URL)", async () => {
    const f = fakeFetch({ json: { id: "111", name: "Vídeo cabelo", campaign: { name: "Método Fiaes outubro", id: "9" }, adset: { name: "Salvador 25-45", id: "8" } } });
    expect(await fetchAdNames("111", { config: cfg, fetch: f.fn })).toEqual({ adName: "Vídeo cabelo", campaignName: "Método Fiaes outubro", adsetName: "Salvador 25-45" });
    const c = f.calls[0];
    expect(c.url.origin + c.url.pathname).toBe("https://graph.facebook.com/v23.0/111");
    expect(c.url.searchParams.get("fields")).toBe("name,campaign{name},adset{name}");
    expect(c.url.toString()).not.toContain("token-de-teste");
    expect(new Headers(c.init?.headers).get("authorization")).toBe("Bearer token-de-teste");
  });

  it("id estranho não vira chamada; erro do Meta vira MetaAdsError sem a chave", async () => {
    const f = fakeFetch({ status: 400, json: { error: { message: "Invalid OAuth access token - token-de-teste", code: 190 } } });
    await expect(fetchAdNames("1/../me", { config: cfg, fetch: f.fn })).rejects.toThrow(MetaAdsError);
    expect(f.calls).toHaveLength(0);
    const e = await fetchAdNames("111", { config: cfg, fetch: f.fn }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(MetaAdsError);
    expect((e as Error).message).toContain("Invalid OAuth");
    expect((e as Error).message).not.toContain("token-de-teste");
  });

  it("gasto por anúncio no período: insights level=ad filtrado pelos ids, em centavos, seguindo a paginação", async () => {
    const f = fakeFetch(
      { json: { data: [{ ad_id: "111", spend: "123.45" }], paging: { next: "https://graph.facebook.com/v23.0/act_123456/insights?after=abc" } } },
      { json: { data: [{ ad_id: "222", spend: "10" }, { ad_id: "111", spend: "0.05" }] } },
    );
    const m = await fetchAdSpend(["111", "222"], { since: "2026-10-01", until: "2026-10-26" }, { config: cfg, fetch: f.fn });
    expect(Object.fromEntries(m)).toEqual({ "111": 12_350, "222": 1_000 });
    const q = f.calls[0].url;
    expect(q.pathname).toBe("/v23.0/act_123456/insights");
    expect(q.searchParams.get("level")).toBe("ad");
    expect(q.searchParams.get("fields")).toBe("ad_id,spend");
    expect(JSON.parse(q.searchParams.get("time_range")!)).toEqual({ since: "2026-10-01", until: "2026-10-26" });
    expect(JSON.parse(q.searchParams.get("filtering")!)).toEqual([{ field: "ad.id", operator: "IN", value: ["111", "222"] }]);
    expect(f.calls[1].url.searchParams.get("after")).toBe("abc");
    expect(new Headers(f.calls[1].init?.headers).get("authorization")).toBe("Bearer token-de-teste");
  });

  it("paginação só segue para o próprio Graph (endereço de fora é ignorado)", async () => {
    const f = fakeFetch({ json: { data: [{ ad_id: "111", spend: "1" }], paging: { next: "https://exemplo.invalid/roubar" } } });
    await fetchAdSpend(["111"], { since: "2026-10-01", until: "2026-10-26" }, { config: cfg, fetch: f.fn });
    expect(f.calls).toHaveLength(1);
  });
});

describe("syncAdNamesFromMeta", () => {
  beforeEach(async () => { await resetDb(); });

  it("preenche os nomes do Meta nos anúncios ainda sem eles; sem configuração, não faz nada", async () => {
    await db.insert(adCampaigns).values([{ adId: "111" }, { adId: "222", metaSyncedAt: new Date() }]);
    const nada = fakeFetch();
    expect(await syncAdNamesFromMeta({ config: null, fetch: nada.fn })).toEqual({ ok: 0, falhas: 0 });
    expect(nada.calls).toHaveLength(0);
    const f = fakeFetch({ json: { name: "Vídeo", campaign: { name: "Método Fiaes" }, adset: { name: "Salvador" } } });
    expect(await syncAdNamesFromMeta({ config: cfg, fetch: f.fn })).toEqual({ ok: 1, falhas: 0 });
    expect(f.calls.map((c) => c.url.pathname)).toEqual(["/v23.0/111"]);
    const [c] = await db.select().from(adCampaigns).where(eq(adCampaigns.adId, "111"));
    expect(c).toMatchObject({ metaAdName: "Vídeo", metaCampaignName: "Método Fiaes", metaAdsetName: "Salvador", name: null });
    expect(c.metaSyncedAt).toBeInstanceOf(Date);
  });
});
