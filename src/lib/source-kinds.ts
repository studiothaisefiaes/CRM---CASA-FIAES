export const SOURCE_KINDS = ["instagram", "google", "panfleto", "indicacao", "anuncio", "recepcao", "outro"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  instagram: "Instagram", google: "Google", panfleto: "Panfleto", indicacao: "Indicação", anuncio: "Anúncio", recepcao: "Recepção", outro: "Outro",
};
