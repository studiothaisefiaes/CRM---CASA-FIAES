/** Foto da profissional (6.10): o limite e a URL servem à tela e ao servidor. O caminho no disco nunca sai do servidor. */
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** "profissionais/<id>/1760000000000.png" → "1760000000000" (a versão muda a cada troca e quebra o cache). */
export const photoVersionOf = (photoPath: string | null): string | null => (photoPath ? (photoPath.split("/").pop() ?? "").replace(/\.[a-z0-9]+$/i, "") || null : null);

export const proPhotoUrl = (id: string, version: string | null, size: "q" | "full" = "q"): string | null =>
  version ? `/api/profissionais/${id}/foto?v=${encodeURIComponent(version)}${size === "full" ? "&tam=grande" : ""}` : null;
