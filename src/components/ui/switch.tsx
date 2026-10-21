"use client";
import { motion } from "motion/react";
import { SPRING_UI } from "@/lib/motion";

/** A trilha tem 42×25; no toque (pointer: coarse) o botão ganha área de 44 px sem mudar o desenho. */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className="group shrink-0 grid place-items-center rounded-full disabled:opacity-50 pointer-coarse:min-h-11 pointer-coarse:min-w-11">
      <span className={`relative block w-[42px] h-[25px] rounded-full transition-colors duration-200 ${checked ? "bg-ok" : "bg-line-strong"}`}>
        <motion.span layout transition={SPRING_UI} className="absolute top-[2.5px] size-5 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)]" style={{ left: checked ? 19.5 : 2.5 }} />
      </span>
    </button>
  );
}
