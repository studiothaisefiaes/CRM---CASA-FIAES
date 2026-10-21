import { stat } from "node:fs/promises";

/** ETag fraca de um arquivo do disco (tamanho + data de alteração): muda quando o arquivo é regravado. null se não existe. */
export async function fileEtag(file: string): Promise<string | null> {
  const s = await stat(file).catch(() => null);
  return s?.isFile() ? `W/"${s.size.toString(36)}-${Math.floor(s.mtimeMs).toString(36)}"` : null;
}

/** O navegador já tem esta versão (If-None-Match bate com a ETag). */
export function matchesEtag(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch.split(",").some((t) => { const v = t.trim(); return v === "*" || v === etag || v.replace(/^W\//, "") === etag.replace(/^W\//, ""); });
}
