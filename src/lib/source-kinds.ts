export const SOURCE_KINDS = ["instagram", "google", "panfleto", "indicacao", "anuncio", "recepcao", "outro"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  instagram: "Instagram", google: "Google", panfleto: "Panfleto", indicacao: "Indicação", anuncio: "Anúncio", recepcao: "Recepção", outro: "Outro",
};

/** Rótulo do lead sem origem real (nem link/QR, nem evidência na conversa). Canal ("WhatsApp") não é origem. */
export const NOT_IDENTIFIED = "Não identificada";
/** Origens que são o canal ou o estado do contato, não como a cliente conheceu a Casa. */
export const isChannelOrigin = (label: string | null | undefined) => /^\s*(whatsapp|já é cliente)\s*$/i.test(label ?? "");
