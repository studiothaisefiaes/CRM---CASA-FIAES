import { describe, expect, it } from "vitest";
import { adAutoLabel, adDisplayName, entryPointOf, parseAdFilter, parseOrigin, safeHttpUrl } from "./ad-origin";
import { AD_REPLY } from "../../test/fixtures/evolution";

describe("origem da conversa: anúncio e porta de entrada", () => {
  it("clique em anúncio (Click-to-WhatsApp): id do anúncio, app, post, texto cortado e porta 'anuncio'", () => {
    const o = parseOrigin([{ externalAdReply: AD_REPLY, entryPointConversionSource: "ctwa_ad", entryPointConversionApp: "instagram" }]);
    expect(o.ad).toMatchObject({ adId: "120232984257440453", sourceApp: "instagram", sourceUrl: "https://www.instagram.com/p/TESTE123/", title: "CASA FIAES", ctwaClid: "AffTESTE123" });
    expect(o.ad!.body!.startsWith("Hoje quis mostrar um cabelo")).toBe(true);
    expect(o.entry).toEqual({ point: "anuncio", raw: "ctwa_ad|instagram" });
  });

  it("anúncio sem a porta de entrada (lote do histórico): a porta é 'anuncio' mesmo assim", () => {
    const o = parseOrigin([null, { externalAdReply: AD_REPLY }]);
    expect(o.ad?.adId).toBe("120232984257440453");
    expect(o.entry).toEqual({ point: "anuncio", raw: "ad" });
  });

  it("o anúncio pode vir no contextInfo do tipo da mensagem (segundo da lista)", () => {
    const o = parseOrigin([{ mentionedJid: [] }, { externalAdReply: { ...AD_REPLY, sourceApp: "facebook" } }]);
    expect(o.ad?.sourceApp).toBe("facebook");
  });

  it("texto do anúncio vem cortado em 500 caracteres; endereço que não é https não entra (nunca vira link)", () => {
    const o = parseOrigin([{ externalAdReply: { ...AD_REPLY, body: "x".repeat(900), sourceUrl: "javascript:alert(1)", mediaUrl: "http://exemplo.com/a" } }]);
    expect(o.ad!.body!.length).toBe(500);
    expect(o.ad!.sourceUrl).toBeNull();
    expect(o.ad!.mediaUrl).toBeNull();
  });

  it("id do anúncio estranho é descartado (fica só o clique)", () => {
    const o = parseOrigin([{ externalAdReply: { ...AD_REPLY, sourceId: "1; drop table" } }]);
    expect(o.ad?.adId).toBeNull();
    expect(o.ad?.ctwaClid).toBe("AffTESTE123");
  });

  it("prévia de link (externalAdReply sem ser anúncio) não é anúncio", () => {
    const o = parseOrigin([{ externalAdReply: { title: "Um site", sourceType: "link", sourceUrl: "https://exemplo.com" }, entryPointConversionSource: "click_to_chat_link" }]);
    expect(o.ad).toBeNull();
    expect(o.entry?.point).toBe("link");
  });

  it("ctwaClid solto no contextInfo também é anúncio (sem id)", () => {
    const o = parseOrigin([{ ctwaClid: "AffSOLTO" }]);
    expect(o.ad).toMatchObject({ adId: null, ctwaClid: "AffSOLTO" });
    expect(o.entry?.point).toBe("anuncio");
  });

  it("conversa nova sem anúncio: porta de entrada normalizada", () => {
    expect(parseOrigin([{ entryPointConversionSource: "global_search_new_chat", entryPointConversionApp: "whatsapp", entryPointConversionDelaySeconds: 10 }]))
      .toEqual({ ad: null, entry: { point: "busca", raw: "global_search_new_chat|whatsapp" } });
    expect(parseOrigin([{ mentionedJid: [] }])).toEqual({ ad: null, entry: null });
    expect(parseOrigin([])).toEqual({ ad: null, entry: null });
  });

  it("normalização da porta: app instagram vence; link, busca, grupo, status e o resto", () => {
    expect(entryPointOf({ source: "click_to_chat_link", app: "instagram" })).toBe("instagram");
    expect(entryPointOf({ source: "click_to_chat_link", app: "whatsapp" })).toBe("link");
    expect(entryPointOf({ source: "click_to_chat_link" })).toBe("link");
    expect(entryPointOf({ source: "phone_number_hyperlink" })).toBe("link");
    expect(entryPointOf({ source: "global_search_new_chat" })).toBe("busca");
    expect(entryPointOf({ source: "group_participant_list" })).toBe("grupo");
    expect(entryPointOf({ source: "status" })).toBe("status");
    expect(entryPointOf({ source: "transactional_qbm" })).toBe("outro");
    expect(entryPointOf({ source: "ctwa_ad" })).toBe("anuncio");
    expect(entryPointOf({ source: "global_search_new_chat", isAd: true })).toBe("anuncio");
    expect(entryPointOf({})).toBeNull();
  });

  it("rótulos: o nome dado pela gestão; sem nome, o texto do anúncio; a origem automática pelo app", () => {
    expect(adAutoLabel("instagram")).toBe("Anúncio Instagram");
    expect(adAutoLabel("facebook")).toBe("Anúncio Facebook");
    expect(adAutoLabel(null)).toBe("Anúncio");
    expect(adDisplayName({ adId: "1", name: " Método Fiaes outubro ", title: "CASA FIAES", body: "abc" })).toBe("Método Fiaes outubro");
    expect(adDisplayName({ adId: "1", name: null, title: "CASA FIAES", body: "Hoje quis mostrar um cabelo sem finalização.\nPorque o Método" })).toBe("“Hoje quis mostrar um cabelo sem finalização. Porque…”");
    expect(adDisplayName({ adId: "1", name: "", title: "CASA FIAES", body: null })).toBe("CASA FIAES");
    expect(adDisplayName({ adId: "123456789", name: null, title: null, body: null })).toBe("Anúncio …6789");
  });

  it("filtro da Fila/Quadro: sim, nao ou um id de anúncio; o resto é ignorado", () => {
    expect(parseAdFilter("sim")).toBe("sim");
    expect(parseAdFilter("nao")).toBe("nao");
    expect(parseAdFilter("120232984257440453")).toBe("120232984257440453");
    expect(parseAdFilter("1; drop")).toBeNull();
    expect(parseAdFilter(undefined)).toBeNull();
  });

  it("safeHttpUrl: só https", () => {
    expect(safeHttpUrl("https://www.instagram.com/p/x/")).toBe("https://www.instagram.com/p/x/");
    expect(safeHttpUrl("http://www.instagram.com/p/x/")).toBeNull();
    expect(safeHttpUrl(" ")).toBeNull();
    expect(safeHttpUrl(42)).toBeNull();
  });
});
