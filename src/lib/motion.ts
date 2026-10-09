// Tokens de movimento: um só vocabulário para o produto inteiro.
export const EASE = [0.22, 1, 0.36, 1] as const;
export const DUR = { fast: 0.14, base: 0.22, slow: 0.42 } as const;
export const SPRING = { type: "spring", stiffness: 420, damping: 34, mass: 0.9 } as const;
export const SPRING_SOFT = { type: "spring", stiffness: 260, damping: 30 } as const;
export const SPRING_DRAG = { type: "spring", stiffness: 520, damping: 38 } as const;
