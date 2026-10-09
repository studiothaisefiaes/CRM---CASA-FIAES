"use client";
import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/** Respeita "reduzir movimento" do sistema também nas animações do Motion (não só no CSS). */
export function AppMotion({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
