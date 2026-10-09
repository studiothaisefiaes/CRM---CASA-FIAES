"use client";
import { motion } from "motion/react";
import { SPRING } from "@/lib/motion";

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={`relative w-[42px] h-[25px] rounded-full transition-colors duration-200 disabled:opacity-50 ${checked ? "bg-ok" : "bg-line-strong"}`}>
      <motion.span layout transition={SPRING} className="absolute top-[2.5px] size-5 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)]" style={{ left: checked ? 19.5 : 2.5 }} />
    </button>
  );
}
