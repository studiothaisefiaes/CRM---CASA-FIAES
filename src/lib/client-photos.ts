/** Fotos de antes e depois da cliente (Fase C, 25b): limites e rótulos. Nenhum código gera nem altera imagem. */
export const PHOTO_KINDS = ["antes", "depois"] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];
export const PHOTO_KIND_LABEL: Record<PhotoKind, string> = { antes: "Antes", depois: "Depois" };
export const isPhotoKind = (v: unknown): v is PhotoKind => typeof v === "string" && (PHOTO_KINDS as readonly string[]).includes(v);

/** Tamanho máximo da foto (Configurações › Fichas da cliente): padrão 5 MB, de 1 a 20. */
export const PHOTO_MAX_MB_DEFAULT = 5;
export const PHOTO_MAX_MB_MIN = 1;
export const PHOTO_MAX_MB_MAX = 20;

export type ClientPhotoItem = { id: string; visitId: string | null; day: string | null; kind: PhotoKind; url: string };
export const clientPhotoUrl = (contactId: string, photoId: string) => `/api/contatos/${contactId}/fotos/${photoId}`;
