/**
 * Telas aprovadas pelo dono e que não mudam de aparência (dsgfix): Conversas (Fila, Quadro, Programadas, conversa e painel), Hoje
 * (Resumo, Recepção, Ao vivo), a grade da Agenda, a página da cliente (/c) e o login. Nelas só entra token global invisível: o mínimo
 * de 12 px e as classes de mesmo valor. A raiz delas leva a classe `ds-congelada` (globals.css), que mantém os tamanhos de antes.
 * Usado pelo teste da escala (design-scale.test.ts).
 */
export const TELAS_CONGELADAS = [
  "src/components/queue/", "src/components/conversa/", "src/components/pipeline/", "src/components/lead/",
  "src/app/(app)/atendimento/", "src/app/(app)/conversa/", "src/app/(app)/funil/",
  "src/components/today/", "src/components/ao-vivo/", "src/app/(app)/ao-vivo/", "src/app/(app)/page.tsx",
  "src/components/agenda/",
  "src/components/client-link/", "src/app/c/", "src/app/login/", "src/components/auth-shell.tsx",
] as const;

/** Rotas do app logado com tela aprovada: a moldura (AppFrame) põe `ds-congelada` em volta delas. */
export const isFrozenPath = (path: string | null | undefined): boolean =>
  !!path && (path === "/" || /^\/(ao-vivo|atendimento|conversa|funil|agenda)(\/|$)/.test(path));
