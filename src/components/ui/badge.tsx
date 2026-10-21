import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "gold" | "ok" | "alert" | "ink";
const tones: Record<Tone, string> = {
  neutral: "bg-paper-2 text-graphite",
  gold: "bg-gold-soft text-gold-ink",
  ok: "bg-ok-soft text-ok",
  alert: "bg-alert-soft text-alert",
  ink: "bg-ink text-paper",
};
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 h-[22px] px-2 rounded-[6px] text-xs font-semibold whitespace-nowrap", tones[tone], className)}>{children}</span>;
}
