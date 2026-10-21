/**
 * Cabeçalho `Range: bytes=a-b` (um intervalo só, que é o que os players pedem). Safari exige 206 para tocar áudio/vídeo.
 * null: sem Range ou formato que não entendemos (responde o arquivo inteiro). "invalid": fora do arquivo (416).
 */
export function parseRange(header: string | null, size: number): { start: number; end: number } | "invalid" | null {
  const m = header?.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) return null;
  let start: number, end: number;
  if (!m[1]) { const n = Number(m[2]); if (n === 0) return "invalid"; start = Math.max(0, size - n); end = size - 1; } // sufixo: últimos n bytes
  else { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; }
  if (start >= size || start > end) return "invalid";
  return { start, end };
}
