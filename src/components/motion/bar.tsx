"use client";
import { motion } from "motion/react";
import { EASE, T_DATA } from "@/lib/motion";
import { cn } from "@/lib/cn";

const TONE = { gold: "bg-gold", ink: "bg-ink", alert: "bg-alert", ok: "bg-ok" } as const;

/**
 * Barra horizontal. Anima só `transform` (scaleX, a partir da esquerda): largura e altura nunca mudam, então a barra não faz o navegador medir layout.
 * Com "reduzir movimento" o MotionConfig global a mostra pronta. `goal` põe a marca da meta; `label` a torna uma imagem com texto alternativo.
 */
export function Bar({ value, max, tone = "gold", delay = 0, goal, label, className }: {
  value: number; max: number; tone?: keyof typeof TONE; delay?: number; goal?: number; label?: string; className?: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={cn("relative h-2.5 rounded-full bg-paper-3 overflow-visible", className)} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <motion.div className={cn("h-full w-full rounded-full", TONE[tone])} style={{ transformOrigin: "left center" }} initial={{ scaleX: 0 }} animate={{ scaleX: pct / 100 }} transition={{ duration: T_DATA, delay, ease: EASE }} />
      {goal != null && max > 0 && <span className="absolute -top-1.5 -bottom-1.5 w-[2px] rounded-full bg-alert/70" style={{ left: `${Math.min(100, (goal / max) * 100)}%` }} aria-hidden />}
    </div>
  );
}
