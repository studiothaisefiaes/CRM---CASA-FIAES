import { asc, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "../db";
import { adCampaigns } from "../db/schema";

/**
 * API de Marketing do Meta (Graph API), PREPARADA E DESLIGADA (26/10): o WhatsApp manda só o id do anúncio, sem o nome da campanha nem o
 * gasto. Com `META_ADS_TOKEN` (token de sistema com ads_read) e `META_AD_ACCOUNT_ID` (act_…) no .env, dá para buscar:
 * - o nome do anúncio, da campanha e do conjunto: GET /{ad_id}?fields=name,campaign{name},adset{name} (`fetchAdNames`, `syncAdNamesFromMeta`
 *   grava em ad_campaigns.meta_*);
 * - o gasto por anúncio num período: GET /act_{conta}/insights?level=ad&fields=ad_id,spend (`fetchAdSpend`, em centavos da moeda da conta).
 * Sem as duas variáveis, nada acontece (nem chamada). Nada aqui roda sozinho: ligar é chamar `syncAdNamesFromMeta` num job do worker.
 * A chave vai no cabeçalho Authorization, nunca na URL (que pode parar em log), e o erro do Meta sai sem ela.
 */
export type MetaAdsConfig = { token: string; accountId: string; version: string };
type Opts = { config?: MetaAdsConfig | null; fetch?: typeof fetch };

const GRAPH = "https://graph.facebook.com";
const AD_ID = /^[0-9]{1,30}$/;

export class MetaAdsError extends Error {}

/** A configuração do .env, ou null (desligado). A conta aceita com ou sem o "act_". */
export function metaAdsConfig(source: Record<string, string | undefined> = process.env): MetaAdsConfig | null {
  const token = source.META_ADS_TOKEN?.trim(), account = source.META_AD_ACCOUNT_ID?.trim();
  if (!token || !account) return null;
  const digits = account.replace(/^act_/, "");
  if (!/^[0-9]{1,30}$/.test(digits)) return null;
  return { token, accountId: `act_${digits}`, version: source.META_GRAPH_VERSION?.trim() || "v23.0" };
}

const configOf = (o: Opts) => (o.config === undefined ? metaAdsConfig() : o.config);

async function graph<T>(url: URL, cfg: MetaAdsConfig, f: typeof fetch): Promise<T> {
  const res = await f(url, { headers: { authorization: `Bearer ${cfg.token}`, accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } };
  if (!res.ok || body.error) {
    const msg = (body.error?.message ?? `HTTP ${res.status}`).split(cfg.token).join("[chave]").slice(0, 200);
    throw new MetaAdsError(`Meta respondeu com erro: ${msg}`);
  }
  return body;
}

/** Nomes do anúncio, da campanha e do conjunto. null quando desligado. */
export async function fetchAdNames(adId: string, o: Opts = {}): Promise<{ adName: string | null; campaignName: string | null; adsetName: string | null } | null> {
  const cfg = configOf(o);
  if (!cfg) return null;
  if (!AD_ID.test(adId)) throw new MetaAdsError("Id de anúncio inválido.");
  const url = new URL(`${GRAPH}/${cfg.version}/${adId}`);
  url.searchParams.set("fields", "name,campaign{name},adset{name}");
  const r = await graph<{ name?: string; campaign?: { name?: string }; adset?: { name?: string } }>(url, cfg, o.fetch ?? fetch);
  return { adName: r.name ?? null, campaignName: r.campaign?.name ?? null, adsetName: r.adset?.name ?? null };
}

/** Gasto por anúncio no período (datas AAAA-MM-DD, no fuso da conta), em centavos. Vazio quando desligado. Segue a paginação do Graph (até 20 páginas). */
export async function fetchAdSpend(adIds: string[], range: { since: string; until: string }, o: Opts = {}): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const cfg = configOf(o);
  const ids = [...new Set(adIds)].filter((id) => AD_ID.test(id));
  if (!cfg || !ids.length) return out;
  if (![range.since, range.until].every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))) throw new MetaAdsError("Período inválido.");
  let url: URL | null = new URL(`${GRAPH}/${cfg.version}/${cfg.accountId}/insights`);
  url.searchParams.set("level", "ad");
  url.searchParams.set("fields", "ad_id,spend");
  url.searchParams.set("time_range", JSON.stringify({ since: range.since, until: range.until }));
  url.searchParams.set("filtering", JSON.stringify([{ field: "ad.id", operator: "IN", value: ids }]));
  url.searchParams.set("limit", "500");
  for (let page = 0; url && page < 20; page++) {
    const r: { data?: { ad_id?: string; spend?: string }[]; paging?: { next?: string } } = await graph(url, cfg, o.fetch ?? fetch);
    for (const x of r.data ?? []) {
      const cents = Math.round(Number(x.spend ?? 0) * 100);
      if (x.ad_id && Number.isFinite(cents)) out.set(x.ad_id, (out.get(x.ad_id) ?? 0) + cents);
    }
    // A próxima página só se for do próprio Graph (o endereço vem da resposta).
    const next: URL | null = r.paging?.next ? new URL(r.paging.next) : null;
    url = next && next.origin === GRAPH ? next : null;
  }
  return out;
}

/**
 * Preenche `meta_ad_name`, `meta_campaign_name` e `meta_adset_name` dos anúncios nunca conferidos (ou conferidos há mais de 1 dia), até
 * `limit` por vez. O nome dado pela gestão (`name`) nunca muda. Desligado: { ok: 0, falhas: 0 } sem chamada.
 */
export async function syncAdNamesFromMeta(o: Opts & { limit?: number; now?: Date } = {}): Promise<{ ok: number; falhas: number }> {
  const cfg = configOf(o);
  if (!cfg) return { ok: 0, falhas: 0 };
  const now = o.now ?? new Date();
  const rows = await db.select({ adId: adCampaigns.adId }).from(adCampaigns)
    .where(or(isNull(adCampaigns.metaSyncedAt), lt(adCampaigns.metaSyncedAt, new Date(now.getTime() - 86_400_000))))
    .orderBy(asc(adCampaigns.lastSeenAt)).limit(o.limit ?? 50);
  let ok = 0, falhas = 0;
  for (const r of rows) {
    try {
      const n = await fetchAdNames(r.adId, { ...o, config: cfg });
      if (!n) continue;
      await db.update(adCampaigns).set({ metaAdName: n.adName, metaCampaignName: n.campaignName, metaAdsetName: n.adsetName, metaSyncedAt: now }).where(eq(adCampaigns.adId, r.adId));
      ok++;
    } catch (e) {
      falhas++;
      console.error("[meta ads] nomes do anúncio", r.adId, e instanceof Error ? e.message : e);
    }
  }
  return { ok, falhas };
}
