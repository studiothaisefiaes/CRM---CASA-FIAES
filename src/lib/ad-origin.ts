/**
 * De onde veio a conversa (pedido do dono, 26/10: "diferenciar as campanhas, o que veio de campanha e o que não veio, como no ChatGuru").
 * Duas informações que o WhatsApp manda na mensagem da cliente (formatos conferidos nos webhooks de produção de 14 a 26/10):
 * - o ANÚNCIO (Click-to-WhatsApp): `contextInfo.externalAdReply` com `sourceType: "ad"`, `sourceId` (o id do anúncio no Meta, que agrupa a
 *   campanha; o nome da campanha não vem), `sourceApp` (instagram | facebook), o post (`sourceUrl`), título, texto e o clique (`ctwaClid`);
 * - a PORTA DE ENTRADA de toda conversa nova: `contextInfo.entryPointConversionSource` (click_to_chat_link, global_search_new_chat,
 *   group_participant_list, phone_number_hyperlink, status, transactional_qbm…) e `entryPointConversionApp` (instagram | whatsapp | ausente).
 * Este arquivo é só a leitura e os textos (vale no navegador); gravar fica em `server/domain/ad-origin.ts`.
 */

/** Porta de entrada normalizada (`deals.entry_point`, com CHECK na migration 0096). */
export const ENTRY_POINTS = ["anuncio", "instagram", "link", "busca", "grupo", "status", "outro"] as const;
export type EntryPoint = (typeof ENTRY_POINTS)[number];
export const isEntryPoint = (v: unknown): v is EntryPoint => typeof v === "string" && (ENTRY_POINTS as readonly string[]).includes(v);

/** A frase da ficha da conversa, para a recepção (texto pequeno embaixo de "Como conheceu"). */
export const ENTRY_POINT_TEXT: Record<EntryPoint, string> = {
  anuncio: "Veio de um anúncio", instagram: "Entrou pelo botão do Instagram", link: "Entrou por link", busca: "Achou o número na busca",
  grupo: "Achou o número num grupo", status: "Entrou por um status", outro: "Entrou por outro caminho do WhatsApp",
};
/** O nome curto (relatório, filtros, API). Sem porta: conversa de antes de 26/10, iniciada pela Casa ou que já existia no WhatsApp. */
export const ENTRY_POINT_LABEL: Record<EntryPoint, string> = {
  anuncio: "Anúncio", instagram: "Botão do Instagram", link: "Link", busca: "Busca do WhatsApp", grupo: "Grupo", status: "Status", outro: "Outro",
};
export const ENTRY_POINT_UNKNOWN = "Não informada";

export type AdInfo = {
  /** `sourceId`: o id do anúncio no Meta. null quando só veio o clique (ctwaClid). */
  adId: string | null;
  sourceApp: string | null; sourceUrl: string | null; mediaUrl: string | null; thumbnailUrl: string | null;
  title: string | null; body: string | null; ctwaClid: string | null;
};
export type EntryInfo = { point: EntryPoint; /** O que o WhatsApp mandou ("fonte|app"), para conferir depois. */ raw: string };
export type OriginInfo = { ad: AdInfo | null; entry: EntryInfo | null };

/** Id de anúncio do Meta: dígitos (aceita letras, _ e -, sem nada que vire SQL/URL estranho). */
const AD_ID = /^[A-Za-z0-9_-]{1,64}$/;
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
/** Só https (o endereço vira link na tela: `javascript:` e companhia nunca passam). */
export function safeHttpUrl(v: unknown): string | null {
  const s = str(v, 1000);
  if (!s) return null;
  try { return new URL(s).protocol === "https:" ? s : null; } catch { return null; }
}

/** Normaliza a porta: anúncio vence; depois o app Instagram (o botão do perfil); depois a fonte. Sem fonte nem app: null. */
export function entryPointOf(i: { source?: string | null; app?: string | null; isAd?: boolean }): EntryPoint | null {
  const source = (i.source ?? "").toLowerCase(), app = (i.app ?? "").toLowerCase();
  if (i.isAd || /(^|_)(ctwa|ads?)(_|$)/.test(source)) return "anuncio";
  if (app === "instagram") return "instagram";
  if (source === "click_to_chat_link" || source === "phone_number_hyperlink") return "link";
  if (source === "global_search_new_chat") return "busca";
  if (source === "group_participant_list") return "grupo";
  if (source === "status") return "status";
  return source || app ? "outro" : null;
}

type Ctx = { externalAdReply?: unknown; ctwaClid?: unknown; conversionSource?: unknown; entryPointConversionSource?: unknown; entryPointConversionApp?: unknown };
type AdReply = { sourceId?: unknown; sourceType?: unknown; sourceApp?: unknown; sourceUrl?: unknown; mediaUrl?: unknown; thumbnailUrl?: unknown; originalImageUrl?: unknown; title?: unknown; body?: unknown; ctwaClid?: unknown };

/**
 * Lê o anúncio e a porta dos `contextInfo` da mensagem (o de `data.contextInfo` e os de dentro de `message.<tipo>`), o primeiro que tiver.
 * É anúncio: `externalAdReply` com `sourceType: "ad"` (ou sem tipo, com `sourceId`), ou o clique (`ctwaClid`), ou `conversionSource` de anúncio.
 * `externalAdReply` de outro tipo (prévia de link) não é anúncio.
 */
export function parseOrigin(contexts: readonly unknown[]): OriginInfo {
  let reply: AdReply | null = null, clid: string | null = null, conv: string | null = null, source: string | null = null, app: string | null = null;
  for (const raw of contexts) {
    if (!raw || typeof raw !== "object") continue;
    const ci = raw as Ctx;
    if (!reply && ci.externalAdReply && typeof ci.externalAdReply === "object") reply = ci.externalAdReply as AdReply;
    clid ??= str(ci.ctwaClid, 200);
    conv ??= str(ci.conversionSource, 60);
    source ??= str(ci.entryPointConversionSource, 60);
    app ??= str(ci.entryPointConversionApp, 30);
  }
  const type = str(reply?.sourceType, 30)?.toLowerCase() ?? null;
  const replyClid = str(reply?.ctwaClid, 200);
  const isAd = !!(replyClid || clid) || type === "ad" || (!!reply && type === null && !!str(reply.sourceId, 64)) || /ads?|ctwa/i.test(conv ?? "");
  const sourceId = str(reply?.sourceId, 64);
  const ad: AdInfo | null = isAd ? {
    adId: sourceId && AD_ID.test(sourceId) ? sourceId : null,
    sourceApp: str(reply?.sourceApp, 30)?.toLowerCase() ?? null,
    sourceUrl: safeHttpUrl(reply?.sourceUrl), mediaUrl: safeHttpUrl(reply?.mediaUrl), thumbnailUrl: safeHttpUrl(reply?.thumbnailUrl ?? reply?.originalImageUrl),
    title: str(reply?.title, 120), body: str(reply?.body, 500), ctwaClid: replyClid ?? clid,
  } : null;
  const point = entryPointOf({ source, app, isAd });
  const entry: EntryInfo | null = point ? { point, raw: [source, app].filter(Boolean).join("|") || "ad" } : null;
  return { ad, entry };
}

/** A origem (`source_label`) da conversa nova de anúncio sem nome dado pela gestão. */
export function adAutoLabel(sourceApp: string | null | undefined): string {
  const a = (sourceApp ?? "").toLowerCase();
  return a === "instagram" ? "Anúncio Instagram" : a === "facebook" ? "Anúncio Facebook" : "Anúncio";
}

/**
 * Como o anúncio aparece (selo da conversa, relatório, filtros): o nome dado pela gestão; sem nome, o começo do texto do anúncio entre aspas
 * (o título costuma ser só "CASA FIAES", igual em todos); sem texto, o título; sem nada, o fim do id.
 */
export function adDisplayName(a: { adId: string; name?: string | null; title?: string | null; body?: string | null }): string {
  const name = a.name?.trim();
  if (name) return name;
  const body = a.body?.replace(/\s+/g, " ").trim();
  if (body) {
    if (body.length <= 52) return `“${body}”`;
    // Corta numa palavra inteira (sem "Por…" no lugar de "Porque…").
    let cut = body.slice(0, 52);
    if (body[52] !== " " && cut.lastIndexOf(" ") > 30) cut = cut.slice(0, cut.lastIndexOf(" "));
    return `“${cut.trimEnd()}…”`;
  }
  return a.title?.trim() || `Anúncio …${a.adId.slice(-4)}`;
}

/** Filtro "Veio de anúncio" da Fila/Quadro/API: `sim`, `nao` ou o id de um anúncio (vale a campanha: os anúncios com o mesmo nome). */
export function parseAdFilter(v: unknown): "sim" | "nao" | string | null {
  if (v === "sim" || v === "nao") return v;
  return typeof v === "string" && AD_ID.test(v) ? v : null;
}
