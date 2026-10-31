import { and, asc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { adCampaigns, deals } from "../db/schema";
import { adDisplayName, parseAdFilter } from "../../lib/ad-origin";

/**
 * Filtro "Veio de anúncio" (Fila, Quadro e API, 26/10): `sim` (veio de anúncio, com ou sem o id), `nao`, ou o id de um anúncio, que vale a
 * CAMPANHA: os anúncios que a gestão nomeou igual (sem nome, só ele). Valor estranho: sem filtro (null).
 */
export function adFilterCond(v: string | null | undefined): SQL | null {
  const f = parseAdFilter(v);
  if (!f) return null;
  const fromAd = sql`(${deals.adId} is not null or ${deals.adCtwaClid} is not null)`;
  if (f === "sim") return fromAd;
  if (f === "nao") return sql`not ${fromAd}`;
  return sql`${deals.adId} in (select a2.ad_id from ad_campaigns a1 join ad_campaigns a2
    on coalesce(nullif(trim(a2.name), ''), a2.ad_id) = coalesce(nullif(trim(a1.name), ''), a1.ad_id) where a1.ad_id = ${f} union select ${f}::text)`;
}

/** As campanhas para o filtro: uma opção por nome (anúncios sem nome, um a um), as não arquivadas que têm conversa. O valor é um dos ids. */
export async function adFilterOptions(): Promise<{ id: string; label: string }[]> {
  const rows = await db.select({ adId: adCampaigns.adId, name: adCampaigns.name, title: adCampaigns.title, body: adCampaigns.body }).from(adCampaigns)
    .where(and(isNull(adCampaigns.archivedAt), sql`exists (select 1 from ${deals} where ${eq(deals.adId, adCampaigns.adId)})`))
    .orderBy(asc(adCampaigns.firstSeenAt), asc(adCampaigns.adId));
  const out = new Map<string, { id: string; label: string }>();
  for (const r of rows) {
    const label = adDisplayName(r);
    const key = r.name?.trim() ? `nome:${label}` : `ad:${r.adId}`;
    if (!out.has(key)) out.set(key, { id: r.adId, label });
  }
  return [...out.values()].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}
