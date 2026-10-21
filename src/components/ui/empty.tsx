import type { ReactNode } from "react";
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-2 py-14 px-6">
      <svg width="44" height="22" viewBox="0 0 88 44" aria-hidden className="text-gold mb-2">
        <path d="M2 30 C14 30 16 8 28 10 C40 12 32 34 22 30 C12 26 24 6 44 12 C62 18 58 36 50 34 C40 31 52 10 70 16 C80 19 84 22 86 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <p className="font-display text-lg text-ink">{title}</p>
      {children && <div className="text-sm text-graphite max-w-[42ch]">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
