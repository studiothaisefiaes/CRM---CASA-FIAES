"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, type ReactNode } from "react";
import { shiftDay } from "@/lib/agenda";
import { dayTitle } from "@/lib/pro-day";

const BTN = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-control)] border border-line-strong text-lg";

/** Um dia da agenda, com troca de dia pelos botões ou passando o dedo (para a esquerda, o dia seguinte). */
export function DayPager({ day, children }: { day: string; children: ReactNode }) {
  const router = useRouter();
  const startX = useRef<number | null>(null);
  const prev = `/pro/dia/${shiftDay(day, -1)}`, next = `/pro/dia/${shiftDay(day, 1)}`;
  return (
    <main className="flex flex-col gap-3"
      onTouchStart={(e) => { startX.current = e.touches[0]?.clientX ?? null; }}
      onTouchEnd={(e) => {
        const s = startX.current; startX.current = null;
        const x = e.changedTouches[0]?.clientX;
        if (s == null || x == null || Math.abs(x - s) < 60) return;
        router.push(x < s ? next : prev);
      }}>
      <div className="flex items-center justify-between gap-2">
        <Link href={prev} aria-label="Dia anterior" className={BTN}>‹</Link>
        <h1 className="text-center font-display text-xl leading-tight">{dayTitle(day)}</h1>
        <Link href={next} aria-label="Próximo dia" className={BTN}>›</Link>
      </div>
      {children}
    </main>
  );
}
