import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "../db";
import { adCampaigns, auditLog, deals, type AdCampaign } from "../db/schema";
import { logEvent } from "./events";
import { UserFacingError } from "./errors";
import { adAutoLabel, adDisplayName, type AdInfo, type OriginInfo } from "@/lib/ad-origin";

/**
 * Grava de onde veio a conversa (anúncio e porta de entrada, ver lib/ad-origin.ts) e cuida dos anúncios em Configurações › Origens.
 * Quem chama (`recordInbound`, `importHistoryChat`, o script de reprocessar) roda isto DEPOIS do commit da mensagem e dentro de try/catch:
 * falhar aqui nunca derruba a ingestão do WhatsApp.
 */
type Q = Tx | typeof db;

/** O rótulo de origem (`deals.source_label`) que um anúncio dá: o nome da gestão; sem nome, "Anúncio Instagram"/"Anúncio Facebook". */
export const adSourceLabel = (c: Pick<AdCampaign, "name" | "sourceApp">) => c.name?.trim() || adAutoLabel(c.sourceApp);
/** Rótulos automáticos que um anúncio pode ter deixado na conversa (o genérico de antes de 26/10 e o pelo app). */
const autoLabels = (sourceApp: string | null) => [...new Set(["Anúncio", adAutoLabel(sourceApp)])];

/** Cria ou atualiza o anúncio visto em `at` (primeira/última vez; o que veio agora completa o que faltava). */
export async function upsertAdCampaign(q: Q, ad: AdInfo & { adId: string }, at: Date): Promise<AdCampaign> {
  const [row] = await q.insert(adCampaigns).values({
    adId: ad.adId, sourceApp: ad.sourceApp, postUrl: ad.sourceUrl, mediaUrl: ad.mediaUrl, thumbnailUrl: ad.thumbnailUrl, title: ad.title, body: ad.body,
    firstSeenAt: at, lastSeenAt: at,
  }).onConflictDoUpdate({
    target: adCampaigns.adId,
    set: {
      firstSeenAt: sql`least(${adCampaigns.firstSeenAt}, excluded.first_seen_at)`,
      lastSeenAt: sql`greatest(${adCampaigns.lastSeenAt}, excluded.last_seen_at)`,
      // A miniatura do Meta expira: a mais nova vale. O resto só completa o que estava vazio.
      thumbnailUrl: sql`coalesce(excluded.thumbnail_url, ${adCampaigns.thumbnailUrl})`,
      sourceApp: sql`coalesce(${adCampaigns.sourceApp}, excluded.source_app)`, postUrl: sql`coalesce(${adCampaigns.postUrl}, excluded.post_url)`,
      mediaUrl: sql`coalesce(${adCampaigns.mediaUrl}, excluded.media_url)`, title: sql`coalesce(${adCampaigns.title}, excluded.title)`,
      body: sql`coalesce(${adCampaigns.body}, excluded.body)`,
    },
  }).returning();
  return row;
}

export type CaptureResult = { ad: boolean; entry: boolean; label: boolean };

/**
 * Grava a origem na conversa, só onde está vazio (idempotente; reprocessar não muda nada):
 * - anúncio (id, clique, hora): se a conversa ainda não tem anúncio. Vale também para a mensagem que chega com a conversa já aberta (a
 *   cliente clicou no anúncio depois): o anúncio fica registrado (evento "anuncio" no histórico) e a etapa, a origem e a porta não mudam;
 * - porta de entrada: só da primeira mensagem da cliente que abriu a conversa (`first`);
 * - origem (`source_label`/`origin`): conversa nova de anúncio sem link/QR e sem origem escolhida (ou só o "Anúncio" genérico) passa a ter o
 *   nome da campanha, se a gestão já deu, ou "Anúncio Instagram"/"Anúncio Facebook".
 */
export async function captureOrigin(i: { dealId: string; origin: OriginInfo; first: boolean; at: Date }, q: Q = db): Promise<CaptureResult> {
  const none = { ad: false, entry: false, label: false };
  const { ad, entry } = i.origin;
  if (!ad && !entry) return none;
  const [d] = await q.select({ adId: deals.adId, clid: deals.adCtwaClid, entryPoint: deals.entryPoint, sourceId: deals.sourceId, sourceLabel: deals.sourceLabel, origin: deals.origin })
    .from(deals).where(eq(deals.id, i.dealId));
  if (!d) return none;
  const campaign = ad?.adId ? await upsertAdCampaign(q, { ...ad, adId: ad.adId }, i.at) : null;
  const noAd = !d.adId && !d.clid;
  const set: Partial<typeof deals.$inferInsert> = {};
  if (ad && noAd) Object.assign(set, { adId: ad.adId, adCtwaClid: ad.ctwaClid, adAt: i.at });
  if (i.first && entry && !d.entryPoint) Object.assign(set, { entryPoint: entry.point, entryPointRaw: entry.raw });
  const label = i.first && ad && noAd && !d.sourceId && (d.sourceLabel === null || d.sourceLabel === "Anúncio")
    ? (campaign ? adSourceLabel(campaign) : adAutoLabel(ad.sourceApp)) : null;
  if (label) { set.sourceLabel = label; if (d.origin === "Anúncio") set.origin = label; }
  if (!Object.keys(set).length) return none;
  // As condições repetidas no WHERE: duas mensagens ao mesmo tempo nunca trocam o que a outra gravou.
  await q.update(deals).set(set).where(and(eq(deals.id, i.dealId),
    ...(set.adAt ? [isNull(deals.adId), isNull(deals.adCtwaClid)] : []), ...(set.entryPoint ? [isNull(deals.entryPoint)] : [])));
  if (ad && noAd && !i.first) await logEvent(q, i.dealId, "anuncio", { adId: ad.adId, nome: campaign ? adDisplayName(campaign) : null, post: ad.sourceUrl });
  return { ad: !!(ad && noAd), entry: !!set.entryPoint, label: !!label };
}

/* ---------- Configurações › Origens › Anúncios ---------- */

export type AdCampaignRow = {
  adId: string; name: string | null; label: string; sourceApp: string | null; postUrl: string | null; title: string | null; body: string | null;
  firstSeenAt: Date; lastSeenAt: Date; archived: boolean; conversas: number;
  /** "Campanha › Conjunto" como está no Meta (só com a API de Marketing ligada; ver meta-ads.ts). */
  meta: string | null;
};

/** Os anúncios vistos: os ativos primeiro (o mais recente em cima), os arquivados no fim. `conversas`: as que vieram dele (sem as de "Não é cliente"). */
export async function listAdCampaigns(): Promise<AdCampaignRow[]> {
  const n = sql<number>`(select count(*)::int from deals d where d.ad_id = ${adCampaigns.adId} and d.archived_at is null)`;
  const rows = await db.select({ c: adCampaigns, n }).from(adCampaigns)
    .orderBy(sql`${adCampaigns.archivedAt} is not null`, desc(adCampaigns.lastSeenAt), asc(adCampaigns.adId));
  return rows.map(({ c, n }) => ({
    adId: c.adId, name: c.name, label: adDisplayName(c), sourceApp: c.sourceApp, postUrl: c.postUrl, title: c.title, body: c.body,
    firstSeenAt: c.firstSeenAt, lastSeenAt: c.lastSeenAt, archived: !!c.archivedAt, conversas: Number(n),
    meta: [c.metaCampaignName, c.metaAdsetName].filter(Boolean).join(" › ") || null,
  }));
}

const zAdId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Anúncio inválido.");
const zName = z.string().trim().max(80, "Nome muito longo (até 80 letras).");

/**
 * Dá (ou tira, com "") o nome do anúncio. O nome vale para as conversas antigas: as que tinham a origem automática do anúncio (ou o nome
 * anterior) passam a ter o nome novo; origem escolhida pela equipe ou link/QR não muda.
 */
export async function nameAdCampaign(adId: string, name: string, userId: string) {
  const id = zAdId.parse(adId), v = zName.parse(name) || null;
  await db.transaction(async (tx) => {
    const [c] = await tx.select().from(adCampaigns).where(eq(adCampaigns.adId, id)).for("update");
    if (!c) throw new UserFacingError("Esse anúncio não existe.");
    const before = adSourceLabel(c);
    const [u] = await tx.update(adCampaigns).set({ name: v, namedBy: userId }).where(eq(adCampaigns.adId, id)).returning();
    const after = adSourceLabel(u);
    if (after !== before) {
      const olds = [...new Set([before, ...autoLabels(c.sourceApp)])];
      await tx.update(deals).set({ sourceLabel: after, origin: sql`case when ${deals.origin} in (${sql.join(olds.map((o) => sql`${o}`), sql`, `)}) then ${after} else ${deals.origin} end` })
        .where(and(eq(deals.adId, id), isNull(deals.sourceId), inArray(deals.sourceLabel, olds)));
    }
    await tx.insert(auditLog).values({ userId, action: "nomeou", entity: "ad_campaign", entityId: id, data: { de: c.name, para: v } });
  });
}

export async function setAdCampaignArchived(adId: string, archived: boolean, userId: string) {
  const id = zAdId.parse(adId);
  const r = await db.update(adCampaigns).set({ archivedAt: archived ? new Date() : null }).where(eq(adCampaigns.adId, id)).returning({ id: adCampaigns.id });
  if (!r.length) throw new UserFacingError("Esse anúncio não existe.");
  await db.insert(auditLog).values({ userId, action: archived ? "arquivou" : "desarquivou", entity: "ad_campaign", entityId: id, data: {} });
}
