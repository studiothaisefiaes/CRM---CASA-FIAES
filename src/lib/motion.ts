// Tokens de movimento: um só vocabulário para o produto inteiro (spec §10).
export const EASE = [0.22, 1, 0.36, 1] as const;
/** Saída: acelera ao sair, para não ficar parada na tela. */
export const EASE_IN = [0.4, 0, 1, 1] as const;

/** Durações em segundos. Nada recorrente passa de 300 ms. */
export const T = { instant: 0.1, fast: 0.15, base: 0.2, enter: 0.25, slow: 0.3 } as const;
/** Gráficos e relatórios podem ser mais lentos (não é interação repetida). */
export const T_DATA = 0.45;
/** Saída = 75% da entrada: quem sai não pode fazer a pessoa esperar. */
export const exitOf = (enter: number) => Math.round(enter * 0.75 * 1000) / 1000;

/** Molas sem quique (amortecimento perto do crítico). */
export const SPRING_UI = { type: "spring", stiffness: 500, damping: 40 } as const;
/** Painel lateral: um pouco mais macia e ainda sem quique. */
export const SPRING_SHEET = { type: "spring", stiffness: 380, damping: 38 } as const;

/** Atalhos prontos: entrada e saída de uma duração. */
export const enterT = (d: number = T.base) => ({ duration: d, ease: EASE }) as const;
export const exitT = (d: number = T.base) => ({ duration: exitOf(d), ease: EASE_IN }) as const;

/** Tetos para a lista não pagar o que não precisa: acima disso, sem animação de entrada, saída nem reordenação. */
export const LIMITS = { layoutItems: 60, presenceItems: 40 } as const;
