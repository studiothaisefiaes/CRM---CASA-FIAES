"use client";
import { motion } from "motion/react";
import { EASE } from "@/lib/motion";

export function Bar({ value, max, tone = "gold", delay = 0, goal }: { value: number; max: number; tone?: "gold" | "ink" | "alert" | "ok"; delay?: number; goal?: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const color = { gold: "bg-gold", ink: "bg-ink", alert: "bg-alert", ok: "bg-ok" }[tone];
  return (
    <div className="relative h-2.5 rounded-full bg-paper-3 overflow-visible">
      <motion.div className={`h-full rounded-full ${color}`} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.9, delay, ease: EASE }} />
      {goal != null && max > 0 && <span className="absolute -top-1 -bottom-1 w-px border-l border-dashed border-alert/70" style={{ left: `${Math.min(100, (goal / max) * 100)}%` }} aria-hidden />}
    </div>
  );
}

export function CountUp({ value, format }: { value: number; format?: "brl" | "int" }) {
  return (
    <motion.span key={value} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE }} className="tabular">
      {format === "brl" ? (value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }) : value.toLocaleString("pt-BR")}
    </motion.span>
  );
}
