"use client";
import { motion } from "motion/react";
import { EASE } from "@/lib/motion";

export { Bar } from "@/components/motion/bar";

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
