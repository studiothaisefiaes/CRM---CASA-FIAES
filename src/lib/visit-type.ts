/**
 * Tipo do horário (Fase C, item 19). Pediu ela e Tanto faz são a preferência (`appointments.preference`); Primeira vez vem de `AgendaItem.firstVisit`
 * e não é gravada. Só Indicação e Noiva são gravadas em `appointments.visit_type`. As chaves ficam fixas; o rótulo e o "em uso" são
 * editáveis em Configurações (settings `tipos_horario`), com este texto como o sugerido.
 */
export const VISIT_TYPES = ["indicacao", "noiva"] as const;
export type VisitType = (typeof VISIT_TYPES)[number];
export const VISIT_TYPE_LABEL: Record<VisitType, string> = { indicacao: "Indicação", noiva: "Noiva" };
export const FIRST_VISIT_LABEL = "Primeira vez";
export const VISIT_TYPE_MAX = 30;

/** Um tipo como a tela o usa: o rótulo em vigor e se está em uso. */
export type VisitTypeOption = { value: VisitType; label: string; active: boolean };
