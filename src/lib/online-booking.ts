/** Agendamento online (Lote 7B, DESLIGADO por padrão): regras puras. */
export type AnyProCandidate = { id: string; name: string; agendaPosition: number | null; dayCount: number };

/** "Qualquer uma" (regra 9 do motor, seção 5.4): quem tem menos horários no dia; empate, a de menor ordem na agenda; depois o nome. */
export function pickAnyPro(c: AnyProCandidate[]): string | null {
  const pos = (p: number | null) => p ?? Number.MAX_SAFE_INTEGER;
  return [...c].sort((a, b) => a.dayCount - b.dayCount || pos(a.agendaPosition) - pos(b.agendaPosition) || a.name.localeCompare(b.name, "pt-BR"))[0]?.id ?? null;
}

/** Anti-robô: preencher em menos de 3 s é recusado; página aberta há mais de 2 h pede para atualizar. */
export const MIN_FILL_MS = 3_000;
export const MAX_FORM_AGE_MS = 2 * 3_600_000;
