import { isChannelOrigin } from "./source-kinds";

/** As opções de "Como conheceu?": as origens da Casa e, para completar, as quatro de sempre. Uma escolha é uma origem de link/QR (`sourceId`) ou só o texto. */
export type OriginChoice = { key: string; label: string; sourceId?: string };

/** Fixas, nesta ordem, no começo da lista. "Outra" (texto livre) é tratada pela tela. */
export const FIXED_ORIGINS = ["Indicação", "Instagram", "Google", "Passou na frente"] as const;

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Junta as fixas, as origens de link/QR ativas e as origens cadastradas em Configurações > Listas, sem repetir pelo nome
 * (sem diferenciar maiúsculas nem acentos) e sem canal ("WhatsApp", "Já é cliente"). Origem de link vence a lista, porque guarda o `sourceId`.
 */
export function originChoices(sources: { id: string; label: string; active: boolean }[], listOrigins: { label: string }[]): OriginChoice[] {
  const bySource = new Map(sources.filter((s) => s.active && !isChannelOrigin(s.label)).map((s) => [norm(s.label), s]));
  const seen = new Set<string>();
  const out: OriginChoice[] = [];
  const add = (label: string) => {
    const k = norm(label);
    if (!k || seen.has(k) || isChannelOrigin(label)) return;
    seen.add(k);
    const src = bySource.get(k);
    out.push({ key: src ? `s:${src.id}` : `o:${k}`, label: src?.label ?? label, ...(src ? { sourceId: src.id } : {}) });
  };
  for (const f of FIXED_ORIGINS) add(f);
  const rest = [...sources.filter((s) => s.active).map((s) => s.label), ...listOrigins.map((o) => o.label)].sort((a, b) => a.localeCompare(b, "pt-BR"));
  for (const l of rest) add(l);
  return out;
}
