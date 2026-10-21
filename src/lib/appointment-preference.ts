/** Preferência pela profissional (6.11), como o Avec: Preferencial × Sem preferência. null = não informado (nunca inventar). */
export const PREFERENCES = ["escolhida", "sem_preferencia"] as const;
export type Preference = (typeof PREFERENCES)[number];
export const PREFERENCE_LABEL: Record<Preference, string> = { escolhida: "Pediu ela", sem_preferencia: "Tanto faz" };

export type PreferenceFilter = "escolhida" | "tanto_faz" | "nao_informado";
export const PREFERENCE_FILTERS: { value: PreferenceFilter; label: string }[] = [
  { value: "escolhida", label: "Escolhida" }, { value: "tanto_faz", label: "Tanto faz" }, { value: "nao_informado", label: "Não informado" },
];
export const parsePreferenceFilter = (v: unknown): PreferenceFilter | null => (PREFERENCE_FILTERS.some((f) => f.value === v) ? (v as PreferenceFilter) : null);
export function matchesPreference(p: string | null | undefined, f: PreferenceFilter | null): boolean {
  if (!f) return true;
  if (f === "escolhida") return p === "escolhida";
  if (f === "tanto_faz") return p === "sem_preferencia";
  return p !== "escolhida" && p !== "sem_preferencia";
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
/** A coluna "Tipo" da reserva do Avec: só os dois tipos de preferência; Encaixe, Retorno e o resto ficam null. */
export function parseAvecPreference(tipo: string | null | undefined): Preference | null {
  const t = fold(tipo ?? "");
  if (t === "preferencial") return "escolhida";
  if (t === "sem preferencia") return "sem_preferencia";
  return null;
}
