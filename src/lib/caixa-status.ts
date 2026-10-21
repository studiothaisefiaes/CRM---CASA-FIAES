const HORA = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" });

/** "Caixa de {nome} · aberto HH:MM" ou "Caixa de {nome} · fechado" (cabeçalho do Caixa; puro, servidor e navegador). */
export const cashStatus = (name: string, mine: { openedAt: Date | string } | null): string =>
  mine ? `Caixa de ${name} · aberto ${HORA.format(new Date(mine.openedAt))}` : `Caixa de ${name} · fechado`;
