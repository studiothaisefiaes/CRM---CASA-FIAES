"use client";
import { motion } from "motion/react";
import { EASE } from "@/lib/motion";

/** Barra horizontal. Anima só `transform` (scaleX, a partir da esquerda); com "reduzir movimento" o MotionConfig global a mostra pronta. */
export function Bar({ value, max, tone = "gold", delay = 0, goal, label }: { value: number; max: number; tone?: "gold" | "ink" | "alert" | "ok"; delay?: number; goal?: number; label?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const color = { gold: "bg-gold", ink: "bg-ink", alert: "bg-alert", ok: "bg-ok" }[tone];
  return (
    <div className="relative h-2.5 rounded-full bg-paper-3 overflow-visible" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <motion.div className={`h-full w-full rounded-full ${color}`} style={{ transformOrigin: "left center" }} initial={{ scaleX: 0 }} animate={{ scaleX: pct / 100 }} transition={{ duration: 0.7, delay, ease: EASE }} />
      {goal != null && max > 0 && <span className="absolute -top-1.5 -bottom-1.5 w-[2px] rounded-full bg-alert/70" style={{ left: `${Math.min(100, (goal / max) * 100)}%` }} aria-hidden />}
    </div>
  );
}

export function CountUp({ value, format }: { value: number; format?: "brl" | "int" }) {
  return (
    <motion.span key={value} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE }} className="tabular inline-block">
      {format === "brl" ? (value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }) : value.toLocaleString("pt-BR")}
    </motion.span>
  );
}

/** Aparece com opacidade e deslocamento curto (só transform/opacity). */
export function Reveal({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  return <motion.div className={className} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.45, ease: EASE }}>{children}</motion.div>;
}
