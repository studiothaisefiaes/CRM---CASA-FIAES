"use client";
import { Children, type ReactNode } from "react";
import { motion } from "motion/react";
import { EASE } from "@/lib/motion";

/** `itemClassNames` vai no wrapper animado de cada filho (ex.: col-span no grid). */
export function Stagger({ children, className, itemClassNames = [] }: { children: ReactNode; className?: string; itemClassNames?: (string | undefined)[] }) {
  return (
    <div className={className}>
      {Children.map(children, (c, i) => (
        <motion.div className={itemClassNames[i]} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 + i * 0.06, duration: 0.5, ease: EASE }}>{c}</motion.div>
      ))}
    </div>
  );
}
