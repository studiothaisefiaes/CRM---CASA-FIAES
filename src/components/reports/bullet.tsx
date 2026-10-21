"use client";
import { motion } from "motion/react";
import { EASE } from "@/lib/motion";

/**
 * Bullet chart em SVG: faixas de fundo (até a meta, até 2x a meta, além), a barra do valor, a marca da meta e, se houver,
 * a marca do período anterior. Para tempos, quanto menor melhor. A barra anima só `scaleX`.
 */
export function Bullet({ value, target, previous, max, label, delay = 0 }: {
  value: number; target: number; previous?: number | null; max?: number; label: string; delay?: number;
}) {
  const top = max ?? Math.max(value, previous ?? 0, target * 2) * 1.04;
  const x = (v: number) => Math.max(0, Math.min(100, (v / top) * 100));
  const t = x(target);
  return (
    <svg viewBox="0 0 100 16" preserveAspectRatio="none" className="block w-full h-4" role="img" aria-label={label}>
      <rect x="0" y="0" width="100" height="16" className="fill-line" />
      <rect x="0" y="0" width={Math.min(100, x(target * 2))} height="16" className="fill-paper-3" />
      <rect x="0" y="0" width={t} height="16" className="fill-gold-soft" />
      <motion.rect x="0" y="5" width={x(value)} height="6" className="fill-ink" style={{ transformBox: "fill-box", transformOrigin: "0% 50%" }}
        initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.7, delay, ease: EASE }} />
      {previous != null && <line x1={x(previous)} x2={x(previous)} y1="3" y2="13" className="stroke-gold-ink" strokeWidth="2" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />}
      <line x1={t} x2={t} y1="0" y2="16" className="stroke-alert" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
