/**
 * Endereço da foto de perfil. Por padrão a miniatura (128 px, ~3 KB); `full`: o original (foto ampliada).
 * Com `version` (quando o worker revisou a foto) o navegador guarda por 1 ano sem perguntar: todas as telas devem usar a MESMA versão,
 * senão a mesma foto vira outra URL e é baixada de novo.
 */
export function avatarUrl(contactId: string, version?: string | null, full = false): string {
  const q = [version ? `v=${encodeURIComponent(version)}` : null, full ? "full=1" : null].filter(Boolean).join("&");
  return `/api/avatar/${contactId}${q ? `?${q}` : ""}`;
}

/** A versão da foto a partir de `contacts.avatarCheckedAt`: os segundos inteiros, igual ao `avatarV` da Fila (queries/queue.ts). */
export function avatarVersion(checkedAt: Date | string | null | undefined): string {
  if (!checkedAt) return "0";
  return String(Math.floor(new Date(checkedAt).getTime() / 1000));
}
