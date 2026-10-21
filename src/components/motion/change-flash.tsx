"use client";
import { useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { EASE } from "@/lib/motion";
import { cn } from "@/lib/cn";

/** Duração do brilho: o suficiente para o olho achar o número que mudou, curto para não virar ruído. */
export const FLASH_MS = 600;

/**
 * Fundo dourado suave por 600 ms quando `value` muda (por exemplo o contador de atrasados). Só anima `opacity` de uma camada atrás do texto.
 * Não brilha na primeira pintura (abrir a tela não é mudança) e não faz nada com "reduzir movimento" nem com `disabled`.
 * O texto exibido é `children` (padrão: o próprio `value`).
 */
export function ChangeFlash({ value, children, className, disabled }: { value: string | number; children?: ReactNode; className?: string; disabled?: boolean }) {
  const reduced = useReducedMotion();
  // "Ajustar estado durante o render": conta as mudanças sem efeito nem ref.
  const [seen, setSeen] = useState({ value, changes: 0 });
  if (seen.value !== value) setSeen({ value, changes: seen.changes + 1 });
  return (
    <span className={cn("relative isolate inline-block", className)}>
      {seen.changes > 0 && !reduced && !disabled && (
        <motion.span key={seen.changes} aria-hidden data-testid="change-flash" initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: FLASH_MS / 1000, ease: EASE }}
          className="pointer-events-none absolute -inset-x-1 inset-y-0 -z-10 rounded-[6px] bg-gold-soft" />
      )}
      {children ?? value}
    </span>
  );
}
