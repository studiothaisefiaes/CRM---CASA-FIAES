"use client";
import { useState } from "react";

const crossed = (from: number, to: number, threshold: number) => from < threshold && to >= threshold;

/**
 * Verdadeiro quando `value` acaba de passar de `threshold` (de abaixo para igual ou acima), e falso no render seguinte em que o valor muda.
 * Nunca no primeiro render (abrir a tela com um lead já atrasado não pulsa) e nunca enquanto continua acima. Serve para o pulso único
 * ao atrasar, no lugar do pulso infinito (WCAG 2.2.2): o componente decide o que fazer (animar 2 ciclos e parar).
 * `threshold` também pode ser uma função do valor anterior (`(prev) => prev + 1` = "subiu"), para limites que andam com o número.
 * O valor anterior vive em estado (padrão "ajustar estado durante o render"), sem ref nem efeito, então StrictMode não muda a resposta.
 * Um re-render sem mudança de valor repete a última resposta; quem anima deve reagir à transição (key/efeito), não à permanência.
 */
export function useCrossedThreshold(value: number, threshold: number | ((previous: number) => number)): boolean {
  const [seen, setSeen] = useState({ value, crossed: false });
  if (seen.value === value) return seen.crossed;
  const now = crossed(seen.value, value, typeof threshold === "function" ? threshold(seen.value) : threshold);
  setSeen({ value, crossed: now });
  return now;
}
