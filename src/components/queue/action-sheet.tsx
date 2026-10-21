"use client";
import type { ReactNode, RefObject } from "react";
import { Sheet } from "@/components/ui/sheet";
import { useDesktop } from "./use-desktop";

/** A folha das ações do lead: lateral no desktop, subindo de baixo no celular. */
export function ActionSheet({ open, onClose, title, footer, initialFocusRef, children }: {
  open: boolean; onClose: () => void; title: string; footer: ReactNode; initialFocusRef?: RefObject<HTMLElement | null>; children: ReactNode;
}) {
  const desktop = useDesktop();
  return (
    <Sheet open={open} onClose={onClose} title={title} side={desktop ? "right" : "bottom"} initialFocusRef={initialFocusRef} footer={footer}
      className="[&>div:last-child]:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {children}
    </Sheet>
  );
}

/** Rótulo de um bloco da folha. */
export function SheetLabel({ id, children, hint }: { id?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <p id={id} className="text-sm font-medium text-graphite">{children}</p>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function FieldError({ children }: { children?: ReactNode }) {
  return children ? <p role="alert" className="mt-1.5 text-sm text-alert">{children}</p> : null;
}
